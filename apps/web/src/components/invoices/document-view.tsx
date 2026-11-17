import type { InvoiceDocModel } from "@/server/documents/model";
import { cn } from "@/lib/cn";
import { QrSvg } from "./qr-svg";

/**
 * HTML rendition of the invoice document. Mirrors the PDF layout and reads
 * the same model, so what you see is what the client gets.
 */
export function DocumentView({ m, logoUrl }: { m: InvoiceDocModel; logoUrl: string | null }) {
  const L = m.labels;
  return (
    <article
      aria-label={`${m.title} ${m.number}`}
      className="doc-paper border-rule-strong shadow-pop relative overflow-hidden rounded-xs border bg-white px-6 py-8 text-[#16140f] sm:px-12 sm:py-12"
      style={{ ["--doc-accent" as string]: m.accent }}
    >
      {m.stamp ? (
        <Stamp
          kind={m.stamp}
          text={m.stamp === "paid" ? L.paid : m.stamp === "void" ? L.void : L.draft}
        />
      ) : null}
      <header className="flex items-start justify-between gap-6">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- authenticated private asset
          <img src={logoUrl} alt={m.seller.name} className="max-h-12 max-w-40 object-contain" />
        ) : (
          <p className="font-[IBM_Plex_Serif] text-xl font-medium">{m.seller.name}</p>
        )}
        <div className="text-right">
          <p className="text-2xs font-medium tracking-[0.14em] text-[#7f7a6b] uppercase">
            {m.title}
          </p>
          <p className="font-[IBM_Plex_Serif] text-xl whitespace-nowrap sm:text-[28px]">
            {m.number}
          </p>
        </div>
      </header>
      <hr className="mt-6 mb-6 border-t-[1.5px]" style={{ borderColor: "var(--doc-accent)" }} />

      <section className="grid gap-6 text-[12.5px] sm:grid-cols-3">
        <Party label={L.from} name={m.seller.name} lines={m.seller.lines} ids={m.seller.ids} />
        <Party label={L.billTo} name={m.buyer.name} lines={m.buyer.lines} ids={m.buyer.ids} />
        <dl className="grid grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1">
          {m.meta.map((r) => (
            <div key={r.label + r.value} className="contents">
              <dt className="text-[#7f7a6b]">{r.label}</dt>
              <dd className="figures text-right">{r.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <table className="mt-9 w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-[#16140f] text-[10px] tracking-[0.1em] text-[#7f7a6b] uppercase">
            <th className="pb-2 text-left font-medium">{L.description}</th>
            <th className="pb-2 text-right font-medium">{L.quantity}</th>
            <th className="hidden pb-2 text-right font-medium sm:table-cell">{L.unitPrice}</th>
            <th className="hidden pb-2 text-right font-medium sm:table-cell">{L.tax}</th>
            <th className="pb-2 text-right font-medium">{L.amount}</th>
          </tr>
        </thead>
        <tbody>
          {m.lines.map((l, i) => (
            <tr key={i} className="border-b border-[#e6e1d6] align-top">
              <td className="py-2 pr-4 whitespace-pre-line">{l.description}</td>
              <td className="figures py-2 text-right text-[#48443a]">{l.quantity}</td>
              <td className="figures hidden py-2 text-right text-[#48443a] sm:table-cell">
                {l.unitPrice}
              </td>
              <td className="figures hidden py-2 text-right text-[#48443a] sm:table-cell">
                {l.tax}
              </td>
              <td className="figures py-2 text-right font-medium">{l.amount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="mt-5 ml-auto w-full max-w-xs text-[12.5px]">
        {m.totals.map((t, i) => (
          <div
            key={i}
            className={cn(
              "flex justify-between",
              t.strong
                ? "mt-1.5 border-t border-[#16140f] pt-1.5 pb-1 text-[14px] font-medium [border-bottom:3px_double_#16140f]"
                : "py-0.5 text-[#48443a]",
            )}
          >
            <dt>{t.label}</dt>
            <dd className="figures">{t.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-8 grid gap-5 text-[12px] text-[#48443a]">
        {m.taxSummary.length ? (
          <Block label={L.taxSummary}>
            {m.taxSummary.map((s) => (
              <p key={s.label} className="figures">
                {s.label}: {L.taxableAmount} {s.taxable} · {L.vat} {s.tax}
              </p>
            ))}
          </Block>
        ) : null}
        {m.taxNotes.map((n) => (
          <Block key={n} label={L.vat}>
            {n}
          </Block>
        ))}
        {m.notes ? <Block label={L.notes}>{m.notes}</Block> : null}
        {m.terms ? <Block label={L.terms}>{m.terms}</Block> : null}
      </div>

      {m.payment ? (
        <section className="mt-8 flex flex-wrap items-start justify-between gap-6 border border-[#e2ddd1] p-5 text-[12px]">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
            <p className="col-span-2 mb-1 text-[10px] font-medium tracking-[0.1em] text-[#7f7a6b] uppercase">
              {L.paymentDetails}
            </p>
            {(
              [
                [L.amountDue, m.payment.due],
                [L.accountHolder, m.payment.holder],
                [L.iban, m.payment.iban],
                [L.bic, m.payment.bic],
                [L.reference, m.payment.remittance],
              ] as const
            ).map(([k, v]) =>
              v ? (
                <div key={k} className="contents">
                  <dt className="text-[#7f7a6b]">{k}</dt>
                  <dd className="figures">{v}</dd>
                </div>
              ) : null,
            )}
          </dl>
          {m.payment.epcPayload ? (
            <figure className="text-center">
              <QrSvg data={m.payment.epcPayload} size={92} />
              <figcaption className="mt-1 text-[10px] text-[#7f7a6b]">{L.scanToPay}</figcaption>
            </figure>
          ) : null}
        </section>
      ) : null}

      <footer className="mt-10 border-t border-[#e2ddd1] pt-3 text-[10.5px] text-[#7f7a6b]">
        {[
          m.seller.name,
          ...m.seller.ids.map((i) => `${i.label} ${i.value}`),
          ...m.seller.contact,
        ].join(" · ")}
        {m.footer ? <p>{m.footer}</p> : null}
      </footer>
    </article>
  );
}

function Party({
  label,
  name,
  lines,
  ids,
}: {
  label: string;
  name: string;
  lines: string[];
  ids: { label: string; value: string }[];
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-medium tracking-[0.12em] text-[#7f7a6b] uppercase">
        {label}
      </p>
      <p className="font-semibold">{name}</p>
      {lines.map((l) => (
        <p key={l} className="text-[#48443a]">
          {l}
        </p>
      ))}
      {ids.map((i) => (
        <p key={i.label} className="mt-0.5 text-[11.5px] text-[#7f7a6b]">
          {i.label} <span className="figures text-[#48443a]">{i.value}</span>
        </p>
      ))}
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="max-w-xl">
      <p className="mb-0.5 text-[10px] font-medium tracking-[0.1em] text-[#7f7a6b] uppercase">
        {label}
      </p>
      <div className="leading-relaxed whitespace-pre-line">{children}</div>
    </div>
  );
}

/** Rubber-stamp mark: slightly rotated, double-ruled, ink at 75%. */
function Stamp({ kind, text }: { kind: "draft" | "paid" | "void"; text: string }) {
  const color = kind === "paid" ? "#2c6a3b" : kind === "void" ? "#b8361a" : "#7f7a6b";
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-9 left-1/2 -translate-x-1/2 -rotate-[8deg] rounded-[3px] border-2 px-4 py-1.5 text-xl font-semibold tracking-[0.2em] uppercase opacity-75"
      style={{
        color,
        borderColor: color,
        boxShadow: `inset 0 0 0 2px #fff, inset 0 0 0 3px ${color}`,
      }}
    >
      {text}
    </div>
  );
}
