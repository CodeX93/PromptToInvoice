/**
 * Invoice lifecycle.
 *
 * The persisted status is deliberately small and orthogonal to delivery and
 * payment facts, which are stored as timestamps/amounts. Everything users see
 * ("overdue", "viewed", "partially paid") is derived, so no cron job has to
 * flip statuses and nothing can drift.
 *
 *   draft ──issue──▶ open ──(paid in full)──▶ paid
 *     │                │  ◀──(refund/reversal)──┘
 *   delete           void (by credit note)
 */

export const INVOICE_STATUSES = ["draft", "open", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export type InvoiceAction =
  "edit" | "delete" | "issue" | "send" | "record_payment" | "void" | "credit";

export interface LifecycleFacts {
  status: InvoiceStatus;
  docType: "invoice" | "credit_note";
  total: number;
  amountPaid: number;
  dueDate: string | null;
  sentAt: Date | string | null;
  viewedAt: Date | string | null;
}

const ALLOWED: Readonly<Record<InvoiceStatus, ReadonlySet<InvoiceAction>>> = {
  draft: new Set(["edit", "delete", "issue"]),
  open: new Set(["send", "record_payment", "void", "credit"]),
  paid: new Set(["send", "credit"]),
  void: new Set(),
};

export function can(
  facts: Pick<LifecycleFacts, "status" | "docType">,
  action: InvoiceAction,
): boolean {
  if (facts.docType === "credit_note" && (action === "credit" || action === "record_payment"))
    return false;
  return ALLOWED[facts.status].has(action);
}

export class LifecycleError extends Error {
  override readonly name = "LifecycleError";
  constructor(
    readonly status: InvoiceStatus,
    readonly action: InvoiceAction,
  ) {
    super(`Cannot ${action.replace("_", " ")} an invoice that is ${status}.`);
  }
}

export function assertCan(
  facts: Pick<LifecycleFacts, "status" | "docType">,
  action: InvoiceAction,
): void {
  if (!can(facts, action)) throw new LifecycleError(facts.status, action);
}

/** Status after a payment (or refund) changes the paid amount. */
export function statusAfterPayment(total: number, amountPaid: number): "open" | "paid" {
  return total > 0 && amountPaid >= total ? "paid" : "open";
}

export type DisplayStatus =
  "draft" | "issued" | "sent" | "viewed" | "partially_paid" | "overdue" | "paid" | "void";

/** What the UI shows. `today` is an ISO date in the org's time zone. */
export function displayStatus(f: LifecycleFacts, today: string): DisplayStatus {
  switch (f.status) {
    case "draft":
      return "draft";
    case "void":
      return "void";
    case "paid":
      return "paid";
    case "open":
      if (f.dueDate !== null && f.dueDate < today && f.docType === "invoice") return "overdue";
      if (f.amountPaid > 0) return "partially_paid";
      if (f.viewedAt) return "viewed";
      if (f.sentAt) return "sent";
      return "issued";
  }
}

export const DISPLAY_STATUS_LABEL: Readonly<Record<DisplayStatus, string>> = {
  draft: "Draft",
  issued: "Issued",
  sent: "Sent",
  viewed: "Viewed",
  partially_paid: "Partially paid",
  overdue: "Overdue",
  paid: "Paid",
  void: "Void",
};

export function amountDue(f: Pick<LifecycleFacts, "total" | "amountPaid" | "status">): number {
  if (f.status === "void" || f.status === "draft") return 0;
  return Math.max(0, f.total - f.amountPaid);
}
