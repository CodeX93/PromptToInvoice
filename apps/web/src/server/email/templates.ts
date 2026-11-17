import "server-only";

/**
 * Transactional email templates. Plain functions that return `{ subject,
 * html, text }` — no runtime renderer, tiny output, and the HTML uses the
 * table layout + inline styles that every mail client understands.
 */

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const C = {
  paper: "#f6f4ee",
  card: "#fbfaf6",
  ink: "#16140f",
  ink2: "#48443a",
  ink3: "#7f7a6b",
  rule: "#e2ddd1",
  accent: "#2340c9",
};

export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

interface LayoutOpts {
  preheader: string;
  heading: string;
  body: string;
  action?: { label: string; url: string };
  footer?: string;
  /** Sender identity shown in the masthead (the business, not us). */
  from?: string;
}

function layout(o: LayoutOpts): string {
  const action = o.action
    ? `<tr><td style="padding:8px 32px 28px"><a href="${escapeHtml(o.action.url)}" style="display:inline-block;background:${C.ink};color:#fff;text-decoration:none;font:500 14px/1 'IBM Plex Sans',Helvetica,Arial,sans-serif;padding:13px 20px;border-radius:3px">${escapeHtml(o.action.label)} &rarr;</a></td></tr>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(o.heading)}</title></head>
<body style="margin:0;padding:0;background:${C.paper}">
<span style="display:none!important;opacity:0;color:transparent;height:0;width:0;overflow:hidden">${escapeHtml(o.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.paper}"><tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${C.card};border:1px solid ${C.rule};border-radius:3px">
<tr><td style="padding:22px 32px;border-bottom:1px solid ${C.rule};font:500 11px/1 'IBM Plex Mono',Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:${C.ink3}">${escapeHtml(o.from ?? "PromptToInvoice")}</td></tr>
<tr><td style="padding:28px 32px 8px;font:400 26px/1.25 Georgia,'Times New Roman',serif;color:${C.ink}">${escapeHtml(o.heading)}</td></tr>
<tr><td style="padding:8px 32px 20px;font:400 15px/1.6 'IBM Plex Sans',Helvetica,Arial,sans-serif;color:${C.ink2}">${o.body}</td></tr>
${action}
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td style="padding:16px 4px;font:400 12px/1.5 'IBM Plex Sans',Helvetica,Arial,sans-serif;color:${C.ink3}">${o.footer ?? "Sent with PromptToInvoice."}</td></tr></table>
</td></tr></table></body></html>`;
}

const p = (s: string) => `<p style="margin:0 0 14px">${s}</p>`;

export function verifyEmail(args: { name: string; url: string }): RenderedEmail {
  return {
    subject: "Confirm your email address",
    html: layout({
      preheader: "One click to confirm your email.",
      heading: "Confirm your email",
      body: p(
        `Hi ${escapeHtml(args.name)}, confirm this address to finish setting up your account. The link expires in 24 hours.`,
      ),
      action: { label: "Confirm email", url: args.url },
      footer: "If you didn't create an account, you can ignore this email.",
    }),
    text: `Hi ${args.name},\n\nConfirm your email address: ${args.url}\n\nThe link expires in 24 hours. If you didn't create an account, ignore this email.`,
  };
}

export function resetPassword(args: { name: string; url: string }): RenderedEmail {
  return {
    subject: "Reset your password",
    html: layout({
      preheader: "A link to choose a new password.",
      heading: "Reset your password",
      body: p(
        `Hi ${escapeHtml(args.name)}, use the button below to choose a new password. The link expires in one hour and works once.`,
      ),
      action: { label: "Choose a new password", url: args.url },
      footer:
        "If you didn't ask for this, your password is unchanged and you can ignore this email.",
    }),
    text: `Hi ${args.name},\n\nChoose a new password: ${args.url}\n\nThe link expires in one hour. If you didn't ask for this, ignore this email.`,
  };
}

export function magicLink(args: { url: string }): RenderedEmail {
  return {
    subject: "Your sign-in link",
    html: layout({
      preheader: "Sign in with one click.",
      heading: "Sign in",
      body: p("Use this link to sign in. It expires in 10 minutes and works once."),
      action: { label: "Sign in", url: args.url },
      footer: "If you didn't request this, you can ignore this email.",
    }),
    text: `Sign in: ${args.url}\n\nThe link expires in 10 minutes. If you didn't request it, ignore this email.`,
  };
}

export function invitation(args: {
  inviter: string;
  org: string;
  role: string;
  url: string;
}): RenderedEmail {
  return {
    subject: `${args.inviter} invited you to ${args.org}`,
    html: layout({
      preheader: `Join ${args.org} on PromptToInvoice.`,
      heading: `Join ${args.org}`,
      body: p(
        `${escapeHtml(args.inviter)} invited you to join <strong>${escapeHtml(args.org)}</strong> as ${escapeHtml(args.role)}. The invitation expires in 7 days.`,
      ),
      action: { label: "Accept invitation", url: args.url },
    }),
    text: `${args.inviter} invited you to join ${args.org} as ${args.role}.\n\nAccept: ${args.url}\n\nThe invitation expires in 7 days.`,
  };
}

export interface InvoiceEmailArgs {
  businessName: string;
  clientName: string;
  docLabel: "Invoice" | "Credit note";
  number: string;
  amount: string;
  dueDate: string | null;
  url: string;
  message: string;
  replyTo: string | null;
}

function messageBlock(message: string): string {
  if (!message.trim()) return "";
  return `<div style="margin:0 0 18px;padding:14px 16px;border-left:2px solid ${C.rule};white-space:pre-line">${escapeHtml(message)}</div>`;
}

function amountBlock(label: string, amount: string, sub: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 18px;width:100%;border-top:1px solid ${C.rule};border-bottom:1px solid ${C.rule}"><tr>
<td style="padding:14px 0;font:500 11px/1 'IBM Plex Mono',Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:${C.ink3}">${escapeHtml(label)}<br><span style="display:block;margin-top:8px;font:400 13px/1.3 'IBM Plex Sans',Helvetica,sans-serif;letter-spacing:0;text-transform:none;color:${C.ink2}">${escapeHtml(sub)}</span></td>
<td align="right" style="padding:14px 0;font:500 22px/1 'IBM Plex Mono',Menlo,monospace;color:${C.ink}">${escapeHtml(amount)}</td></tr></table>`;
}

export function invoiceEmail(a: InvoiceEmailArgs): RenderedEmail {
  const due = a.dueDate ? `Due ${a.dueDate}` : "Due on receipt";
  const sub = a.docLabel === "Invoice" ? due : "Credit issued";
  return {
    subject: `${a.docLabel} ${a.number} from ${a.businessName}`,
    html: layout({
      from: a.businessName,
      preheader: `${a.docLabel} ${a.number} · ${a.amount} · ${sub}`,
      heading: `${a.docLabel} ${a.number}`,
      body:
        p(`Hello ${escapeHtml(a.clientName)},`) +
        messageBlock(a.message) +
        amountBlock(a.docLabel === "Invoice" ? "Amount due" : "Credit amount", a.amount, sub) +
        p(
          `The PDF is attached. You can also view${a.docLabel === "Invoice" ? " and pay" : ""} it online.`,
        ),
      action: {
        label: a.docLabel === "Invoice" ? "View & pay invoice" : "View credit note",
        url: a.url,
      },
      footer: a.replyTo
        ? `Questions? Reply to this email to reach ${escapeHtml(a.businessName)} at ${escapeHtml(a.replyTo)}.`
        : `Sent by ${escapeHtml(a.businessName)} using PromptToInvoice.`,
    }),
    text: `Hello ${a.clientName},\n\n${a.message ? a.message + "\n\n" : ""}${a.docLabel} ${a.number}: ${a.amount} (${sub})\n\nView online: ${a.url}\n\n${a.businessName}`,
  };
}

export function reminderEmail(a: InvoiceEmailArgs & { daysOverdue: number }): RenderedEmail {
  const when =
    a.daysOverdue > 0
      ? `${a.daysOverdue} day${a.daysOverdue === 1 ? "" : "s"} overdue`
      : `due ${a.dueDate ?? "now"}`;
  return {
    subject: `Reminder: invoice ${a.number} is ${a.daysOverdue > 0 ? "overdue" : "due soon"}`,
    html: layout({
      from: a.businessName,
      preheader: `Invoice ${a.number} · ${a.amount} · ${when}`,
      heading: a.daysOverdue > 0 ? "A friendly reminder" : "Payment due soon",
      body:
        p(`Hello ${escapeHtml(a.clientName)},`) +
        messageBlock(a.message) +
        amountBlock("Outstanding", a.amount, `Invoice ${a.number} · ${when}`) +
        p("If you've already paid, thank you, and please ignore this reminder."),
      action: { label: "View & pay invoice", url: a.url },
      footer: a.replyTo
        ? `Questions? Reply to reach ${escapeHtml(a.businessName)}.`
        : `Sent by ${escapeHtml(a.businessName)}.`,
    }),
    text: `Hello ${a.clientName},\n\n${a.message ? a.message + "\n\n" : ""}Invoice ${a.number} for ${a.amount} is ${when}.\n\nView and pay: ${a.url}\n\nIf you've already paid, please ignore this reminder.\n\n${a.businessName}`,
  };
}

export function receiptEmail(a: {
  businessName: string;
  clientName: string;
  number: string;
  amount: string;
  url: string;
}): RenderedEmail {
  return {
    subject: `Payment received for invoice ${a.number}`,
    html: layout({
      from: a.businessName,
      preheader: `Thanks — ${a.amount} received.`,
      heading: "Payment received",
      body:
        p(`Hello ${escapeHtml(a.clientName)},`) +
        amountBlock("Paid", a.amount, `Invoice ${a.number}`) +
        p("Thank you. This email is your receipt."),
      action: { label: "View invoice", url: a.url },
    }),
    text: `Hello ${a.clientName},\n\nWe received ${a.amount} for invoice ${a.number}. Thank you.\n\n${a.url}\n\n${a.businessName}`,
  };
}
