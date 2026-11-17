import "server-only";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import type { InvoiceDocModel } from "./model";

/**
 * Invoice PDF renderer (pdfkit). Vector text with embedded, subsetted IBM
 * Plex fonts; PDF/A-3b so it can carry an EN 16931 XML attachment
 * (ZUGFeRD / Factur-X) and qualify for long-term archiving.
 */

const FONT_DIR = join(process.cwd(), "assets", "fonts");
const F = {
  sans: join(FONT_DIR, "IBMPlexSans-Regular.woff"),
  sansMed: join(FONT_DIR, "IBMPlexSans-Medium.woff"),
  sansSemi: join(FONT_DIR, "IBMPlexSans-SemiBold.woff"),
  sansIt: join(FONT_DIR, "IBMPlexSans-Italic.woff"),
  mono: join(FONT_DIR, "IBMPlexMono-Regular.woff"),
  monoMed: join(FONT_DIR, "IBMPlexMono-Medium.woff"),
  serif: join(FONT_DIR, "IBMPlexSerif-Regular.woff"),
  serifMed: join(FONT_DIR, "IBMPlexSerif-Medium.woff"),
};

const INK = "#16140f";
const INK2 = "#48443a";
const INK3 = "#7f7a6b";
const RULE = "#d9d3c5";

export interface PdfAttachment {
  name: string;
  content: Buffer;
  mime: string;
  description: string;
  relationship: "Alternative" | "Data" | "Source" | "Supplement";
}

export interface RenderOptions {
  logo?: Buffer | null;
  paper?: "A4" | "LETTER";
  attachments?: PdfAttachment[];
  /** Extra XMP (Factur-X extension schema) injected by the e-invoice module. */
  xmpExtension?: string;
  producer?: string;
}

export async function renderInvoicePdf(m: InvoiceDocModel, opts: RenderOptions = {}): Promise<Buffer> {
  const doc = new PDFDocument({
    size: opts.paper ?? "A4",
    margins: { top: 56, bottom: 64, left: 56, right: 56 },
    bufferPages: true,
    pdfVersion: "1.7",
    subset: "PDF/A-3b",
    tagged: true,
    lang: m.locale,
    displayTitle: true,
    info: {
      Title: `${m.title} ${m.number}`,
      Author: m.seller.name,
      Subject: `${m.title} ${m.number} · ${m.buyer.name}`,
      Creator: "PromptToInvoice",
      Producer: opts.producer ?? "PromptToInvoice",
    },
  });
  for (const [name, path] of Object.entries(F)) doc.registerFont(name, path);
  if (opts.xmpExtension) (doc as unknown as { appendXML: (x: string) => void }).appendXML(opts.xmpExtension);
  for (const a of opts.attachments ?? []) {
    // `relationship` (AFRelationship, required by Factur-X) is supported by pdfkit ≥0.15 but missing from @types/pdfkit.
    doc.file(a.content, { name: a.name, type: a.mime, description: a.description, relationship: a.relationship, hidden: false } as PDFKit.Mixins.PDFAttachmentOptions);
  }

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const W = doc.page.width;
  const L = doc.page.margins.left;
  const R = W - doc.page.margins.right;
  const CW = R - L;
  const accent = /^#[0-9a-f]{6}$/i.test(m.accent) ? m.accent : INK;

  // ── Masthead ──────────────────────────────────────────────────────────
  let y = doc.page.margins.top;
  if (opts.logo) {
    try {
      doc.image(opts.logo, L, y, { fit: [150, 48] });
    } catch {
      /* unreadable logo: fall back to the name */
    }
  } else {
    doc.font("serifMed").fontSize(17).fillColor(INK).text(m.seller.name, L, y, { width: CW * 0.55 });
  }
  doc.font("sansMed").fontSize(7.5).fillColor(INK3).text(m.title.toUpperCase(), L, y, { width: CW, align: "right", characterSpacing: 1.2 });
  doc.font("serif").fontSize(22).fillColor(INK).text(m.number, L, y + 12, { width: CW, align: "right" });
  y += 64;
  doc.moveTo(L, y).lineTo(R, y).lineWidth(1.2).strokeColor(accent).stroke();
  y += 18;

  // ── Parties & meta ────────────────────────────────────────────────────
  const colW = (CW - 24) / 3;
  const block = (x: number, label: string, name: string, lines: string[], ids: { label: string; value: string }[]) => {
    let by = y;
    doc.font("sansMed").fontSize(7).fillColor(INK3).text(label.toUpperCase(), x, by, { width: colW, characterSpacing: 1 });
    by += 12;
    doc.font("sansSemi").fontSize(9.5).fillColor(INK).text(name, x, by, { width: colW });
    by = doc.y + 1;
    doc.font("sans").fontSize(8.5).fillColor(INK2);
    for (const l of lines) {
      doc.text(l, x, by, { width: colW });
      by = doc.y;
    }
    for (const id of ids) {
      doc.font("sans").fontSize(8).fillColor(INK3).text(`${id.label} `, x, by + 2, { continued: true }).font("mono").fillColor(INK2).text(id.value);
      by = doc.y;
    }
    return by;
  };
  const yFrom = block(L, m.labels.from, m.seller.name, m.seller.lines, m.seller.ids);
  const yTo = block(L + colW + 12, m.labels.billTo, m.buyer.name, m.buyer.lines, m.buyer.ids);
  let my = y;
  const mx = L + 2 * (colW + 12);
  for (const row of m.meta) {
    doc.font("sans").fontSize(8).fillColor(INK3).text(row.label, mx, my, { width: colW * 0.48 });
    doc.font("mono").fontSize(8.5).fillColor(INK).text(row.value, mx + colW * 0.48, my, { width: colW * 0.52, align: "right" });
    my = Math.max(doc.y, my + 12) + 2;
  }
  y = Math.max(yFrom, yTo, my) + 26;

  // ── Line items ────────────────────────────────────────────────────────
  const cols = [
    { key: "description", w: CW - 64 - 78 - 44 - 82, align: "left" as const, font: "sans" },
    { key: "quantity", w: 64, align: "right" as const, font: "mono" },
    { key: "unitPrice", w: 78, align: "right" as const, font: "mono" },
    { key: "tax", w: 44, align: "right" as const, font: "mono" },
    { key: "amount", w: 82, align: "right" as const, font: "monoMed" },
  ] as const;
  const head = [m.labels.description, m.labels.quantity, m.labels.unitPrice, m.labels.tax, m.labels.amount];
  const bottom = () => doc.page.height - doc.page.margins.bottom - 20;

  const drawHeader = () => {
    let x = L;
    cols.forEach((c, i) => {
      doc.font("sansMed").fontSize(7).fillColor(INK3).text((head[i] ?? "").toUpperCase(), x + (i === 0 ? 0 : 4), y, { width: c.w - (i === 0 ? 4 : 4), align: c.align, characterSpacing: 0.8 });
      x += c.w;
    });
    y += 12;
    doc.moveTo(L, y).lineTo(R, y).lineWidth(0.8).strokeColor(INK).stroke();
    y += 6;
  };
  drawHeader();

  for (const line of m.lines) {
    doc.font("sans").fontSize(9);
    const h = Math.max(doc.heightOfString(line.description, { width: cols[0].w - 8 }), 11) + 8;
    if (y + h > bottom()) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeader();
    }
    let x = L;
    cols.forEach((c, i) => {
      const value = line[c.key];
      doc.font(c.font).fontSize(i === 0 ? 9 : 8.5).fillColor(i === 0 || i === 4 ? INK : INK2).text(value, x + (i === 0 ? 0 : 4), y + (i === 0 ? 0 : 0.5), { width: c.w - (i === 0 ? 8 : 4), align: c.align });
      x += c.w;
    });
    y += h;
    doc.moveTo(L, y - 4).lineTo(R, y - 4).lineWidth(0.4).strokeColor(RULE).stroke();
  }

  // ── Totals ────────────────────────────────────────────────────────────
  const tW = 230;
  const tx = R - tW;
  const totalsH = m.totals.length * 16 + 20;
  if (y + totalsH > bottom()) {
    doc.addPage();
    y = doc.page.margins.top;
  }
  y += 6;
  for (const t of m.totals) {
    if (t.strong) {
      doc.moveTo(tx, y).lineTo(R, y).lineWidth(0.8).strokeColor(INK).stroke();
      y += 5;
    }
    doc.font(t.strong ? "sansSemi" : "sans").fontSize(t.strong ? 10 : 8.5).fillColor(t.strong ? INK : INK2).text(t.label, tx, y, { width: tW * 0.55 });
    doc.font(t.strong ? "monoMed" : "mono").fontSize(t.strong ? 10.5 : 8.5).fillColor(INK).text(t.value, tx + tW * 0.4, y, { width: tW * 0.6, align: "right" });
    y += t.strong ? 17 : 14;
    if (t.strong) {
      // Ledger double rule under a final total.
      doc.moveTo(tx, y - 2).lineTo(R, y - 2).lineWidth(0.6).strokeColor(INK).stroke();
      doc.moveTo(tx, y).lineTo(R, y).lineWidth(0.6).strokeColor(INK).stroke();
      y += 6;
    }
  }

  // ── Tax summary & notes ───────────────────────────────────────────────
  const para = (label: string, text: string) => {
    if (!text.trim()) return;
    doc.font("sans").fontSize(8.5);
    const h = doc.heightOfString(text, { width: CW * 0.62 }) + 16;
    if (y + h > bottom()) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc.font("sansMed").fontSize(7).fillColor(INK3).text(label.toUpperCase(), L, y, { characterSpacing: 0.8 });
    doc.font("sans").fontSize(8.5).fillColor(INK2).text(text, L, y + 11, { width: CW * 0.62, lineGap: 1.5 });
    y = doc.y + 12;
  };
  y += 10;
  if (m.taxSummary.length) {
    para(m.labels.taxSummary, m.taxSummary.map((s) => `${s.label}:  ${m.labels.taxableAmount} ${s.taxable}  ·  ${m.labels.vat} ${s.tax}`).join("\n"));
  }
  for (const n of m.taxNotes) para(m.labels.vat, n);
  para(m.labels.notes, m.notes);
  para(m.labels.terms, m.terms);

  // ── Payment ───────────────────────────────────────────────────────────
  if (m.payment) {
    const p = m.payment;
    const boxH = m.payment.payUrl ? 104 : 92;
    if (y + boxH > bottom()) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    y += 4;
    doc.rect(L, y, CW, boxH).lineWidth(0.6).strokeColor(RULE).stroke();
    const px = L + 14;
    let py = y + 12;
    doc.font("sansMed").fontSize(7).fillColor(INK3).text(m.labels.paymentDetails.toUpperCase(), px, py, { characterSpacing: 0.8 });
    py += 14;
    const kv = (k: string, v: string | null) => {
      if (!v) return;
      doc.font("sans").fontSize(8).fillColor(INK3).text(k, px, py, { width: 90 });
      doc.font("mono").fontSize(8.5).fillColor(INK).text(v, px + 90, py, { width: CW - 220 });
      py += 13;
    };
    kv(m.labels.amountDue, p.due);
    kv(m.labels.accountHolder, p.holder);
    kv(m.labels.iban, p.iban);
    kv(m.labels.bic, p.bic);
    kv(m.labels.reference, p.remittance || null);
    if (p.payUrl) {
      doc.font("sans").fontSize(8).fillColor(INK3).text(m.labels.payOnline, px, py, { width: 90 });
      doc.font("sans").fontSize(8.5).fillColor(accent).text(p.payUrl, px + 90, py, { width: CW - 220, link: p.payUrl, underline: true });
      py += 13;
    }
    if (p.epcPayload) {
      const qr = QRCode.create(p.epcPayload, { errorCorrectionLevel: "M" });
      const size = 68;
      const n = qr.modules.size;
      const cell = size / n;
      const qx = R - 14 - size;
      const qy = y + 12;
      doc.save().fillColor(INK);
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.modules.get(r, c)) doc.rect(qx + c * cell, qy + r * cell, cell + 0.05, cell + 0.05).fill();
      doc.restore();
      doc.font("sans").fontSize(6.5).fillColor(INK3).text(m.labels.scanToPay, qx - 40, qy + size + 3, { width: size + 40, align: "right" });
    }
    y += boxH + 10;
  }

  // ── Stamp ─────────────────────────────────────────────────────────────
  if (m.stamp) {
    const text = m.stamp === "paid" ? m.labels.paid : m.stamp === "void" ? m.labels.void : m.labels.draft;
    const color = m.stamp === "paid" ? "#2c6a3b" : m.stamp === "void" ? "#b8361a" : INK3;
    doc.switchToPage(0);
    doc.save();
    // Centred in the masthead whitespace so it never covers content.
    const cx = L + CW / 2;
    const cy = doc.page.margins.top + 18;
    doc.rotate(-8, { origin: [cx, cy] });
    doc.font("sansSemi").fontSize(18);
    const w = doc.widthOfString(text.toUpperCase(), { characterSpacing: 3 }) + 26;
    doc.opacity(0.75).rect(cx - w / 2, cy - 15, w, 32).lineWidth(1.8).strokeColor(color).stroke();
    doc.fillColor(color).text(text.toUpperCase(), cx - w / 2, cy - 8, { width: w, align: "center", characterSpacing: 3 });
    doc.restore();
  }

  // ── Footer on every page ──────────────────────────────────────────────
  const range = doc.bufferedPageRange();
  const footer = [m.seller.name, ...m.seller.ids.map((i) => `${i.label} ${i.value}`), ...m.seller.contact].join("  ·  ");
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Drawing inside the bottom margin would make pdfkit auto-add a page; lift the margin while we draw.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fy = doc.page.height - savedBottom + 22;
    doc.moveTo(L, fy - 8).lineTo(R, fy - 8).lineWidth(0.4).strokeColor(RULE).stroke();
    doc.font("sans").fontSize(7).fillColor(INK3).text(m.footer ? `${footer}\n${m.footer}` : footer, L, fy, { width: CW - 70, lineBreak: true, height: 24, ellipsis: true });
    doc.font("mono").fontSize(7).fillColor(INK3).text(`${m.labels.page} ${i + 1}/${range.count}`, R - 70, fy, { width: 70, align: "right" });
    doc.page.margins.bottom = savedBottom;
  }

  doc.end();
  return done;
}
