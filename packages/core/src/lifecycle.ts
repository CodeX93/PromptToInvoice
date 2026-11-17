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
  docType: "invoice" | "credit_note" | "quote";
  acceptedAt?: Date | string | null;
  declinedAt?: Date | string | null;
  convertedInvoiceId?: string | null;
  total: number;
  amountPaid: number;
  /** Sum of issued credit notes against the invoice. */
  creditedAmount?: number;
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
  if (facts.docType !== "invoice" && (action === "credit" || action === "record_payment"))
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
export function statusAfterPayment(
  total: number,
  amountPaid: number,
  creditedAmount = 0,
): "open" | "paid" {
  return total > 0 && amountPaid + creditedAmount >= total ? "paid" : "open";
}

export type DisplayStatus =
  | "draft"
  | "issued"
  | "sent"
  | "viewed"
  | "partially_paid"
  | "overdue"
  | "paid"
  | "void"
  | "accepted"
  | "declined"
  | "expired"
  | "converted";

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
      if (f.docType === "quote") {
        // Quotes: the due date is the "valid until" date.
        if (f.convertedInvoiceId) return "converted";
        if (f.acceptedAt) return "accepted";
        if (f.declinedAt) return "declined";
        if (f.dueDate !== null && f.dueDate < today) return "expired";
        if (f.viewedAt) return "viewed";
        return f.sentAt ? "sent" : "issued";
      }
      if (f.dueDate !== null && f.dueDate < today && f.docType === "invoice") return "overdue";
      if (f.amountPaid > 0 || (f.creditedAmount ?? 0) > 0) return "partially_paid";
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
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
  converted: "Invoiced",
};

export function amountDue(
  f: Pick<LifecycleFacts, "total" | "amountPaid" | "status" | "creditedAmount"> & {
    docType?: LifecycleFacts["docType"];
  },
): number {
  if (f.status === "void" || f.status === "draft") return 0;
  if ("docType" in f && f.docType === "quote") return 0;
  return Math.max(0, f.total - f.amountPaid - (f.creditedAmount ?? 0));
}
