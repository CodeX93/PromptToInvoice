import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { amountDue, formatDate, formatMoney, hasFeature, type CurrencyCode } from "@pti/core";
import { DocumentView } from "@/components/invoices/document-view";
import { Wordmark } from "@/components/brand/wordmark";
import { features } from "@/server/env";
import { hit, RULES } from "@/server/rate-limit";
import { getSession } from "@/server/session";
import { modelFor } from "@/server/documents/service";
import { loadPublicInvoice, recordPublicView } from "@/server/services/public-invoices";

export const metadata: Metadata = { title: "Invoice", robots: { index: false, follow: false } };

const ERRORS: Record<string, string> = {
  conflict: "This invoice can't be paid online right now. Use the bank details below.",
  stripe_disabled: "Online payment isn't available. Use the bank details below.",
  stripe_error: "The payment page couldn't be opened. Please try again.",
};

/**
 * The page a client sees. No app chrome, no tracking pixels: the document,
 * what's owed, and the ways to pay.
 */
export default async function PublicInvoicePage(props: PageProps<"/i/[token]">) {
  const { token } = await props.params;
  const sp = await props.searchParams;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await hit(`pub:${ip}`, RULES.publicInvoice)).allowed) notFound();
  const found = await loadPublicInvoice(token);
  if (!found) notFound();
  const { ctx, detail, stripeReady } = found;
  const inv = detail.invoice;
  const session = await getSession();
  after(() => recordPublicView(inv.orgId, inv.id, session?.user.id ?? null));

  const m = await modelFor(ctx, detail);
  const currency: CurrencyCode = m.currency;
  const due = amountDue(inv);
  const canPay =
    features.stripe && stripeReady && inv.docType === "invoice" && inv.status === "open" && due > 0;
  const justPaid = sp.paid === "1";
  const error = typeof sp.error === "string" ? (ERRORS[sp.error] ?? ERRORS.stripe_error) : null;

  return (
    <div className="bg-paper-sunk min-h-dvh">
      <header className="mx-auto flex max-w-[1080px] items-center justify-between px-4 py-5 sm:px-6">
        <p className="font-serif text-lg">{m.seller.name}</p>
        <a
          href={`/i/${token}/pdf`}
          className="text-ink-2 hover:text-ink text-[13px] underline underline-offset-4"
        >
          Download PDF
        </a>
      </header>

      <main className="mx-auto grid max-w-[1080px] gap-6 px-4 pb-16 sm:px-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="lg:order-2">
          <section className="border-rule-strong bg-paper-raised rounded-xs border p-6 lg:sticky lg:top-6">
            {inv.status === "paid" ? (
              <>
                <p className="label-caps">Status</p>
                <p className="text-positive mt-1 font-serif text-2xl">Paid in full</p>
                <p className="text-ink-3 mt-2 text-sm">Thank you. No further action needed.</p>
              </>
            ) : inv.status === "void" ? (
              <>
                <p className="label-caps">Status</p>
                <p className="mt-1 font-serif text-2xl">Cancelled</p>
                <p className="text-ink-3 mt-2 text-sm">
                  This invoice was cancelled with a credit note. Nothing is due.
                </p>
              </>
            ) : inv.docType === "quote" ? (
              <>
                <p className="label-caps">Quote</p>
                <p className="figures mt-1 text-3xl">
                  {formatMoney(inv.total, currency, m.locale)}
                </p>
                {inv.dueDate ? (
                  <p className="text-ink-3 mt-1 text-sm">
                    valid until {formatDate(inv.dueDate, m.locale, "long")}
                  </p>
                ) : null}
                {inv.acceptedAt || sp.answered === "accepted" ? (
                  <p
                    role="status"
                    className="border-positive bg-positive-soft text-positive mt-5 border-l-2 px-3 py-2 text-sm"
                  >
                    Accepted. Thank you! {m.seller.name} has been notified.
                  </p>
                ) : inv.declinedAt || sp.answered === "declined" ? (
                  <p role="status" className="text-ink-2 mt-5 text-sm">
                    You declined this quote.
                  </p>
                ) : detail.status === "expired" ? (
                  <p className="text-ink-3 mt-5 text-sm">
                    This quote has expired. Contact {m.seller.name} for an updated one.
                  </p>
                ) : (
                  <form method="post" action={`/i/${token}/answer`} className="mt-6 grid gap-2">
                    <button
                      type="submit"
                      name="answer"
                      value="accept"
                      className="bg-ink text-paper hover:bg-ink-2 h-11 rounded-sm text-[15px] font-medium"
                    >
                      Accept quote
                    </button>
                    <button
                      type="submit"
                      name="answer"
                      value="decline"
                      className="text-ink-3 hover:text-ink h-9 text-sm"
                    >
                      Decline
                    </button>
                  </form>
                )}
              </>
            ) : inv.docType === "credit_note" ? (
              <>
                <p className="label-caps">Credit note</p>
                <p className="figures mt-1 text-2xl">
                  {formatMoney(Math.abs(inv.total), currency, m.locale)}
                </p>
              </>
            ) : (
              <>
                <p className="label-caps">Amount due</p>
                <p className="figures mt-1 text-3xl">{formatMoney(due, currency, m.locale)}</p>
                {inv.dueDate ? (
                  <p className="text-ink-3 mt-1 text-sm">
                    by {formatDate(inv.dueDate, m.locale, "long")}
                  </p>
                ) : null}
                {justPaid ? (
                  <p
                    role="status"
                    className="border-positive bg-positive-soft text-positive mt-5 border-l-2 px-3 py-2 text-sm"
                  >
                    Payment received. It can take a moment to show here; a receipt is on its way.
                  </p>
                ) : null}
                {error ? (
                  <p
                    role="alert"
                    className="border-warning bg-warning-soft text-warning mt-5 border-l-2 px-3 py-2 text-sm"
                  >
                    {error}
                  </p>
                ) : null}
                {canPay && !justPaid ? (
                  <form method="post" action={`/i/${token}/pay`} className="mt-6">
                    <button
                      type="submit"
                      className="bg-ink text-paper hover:bg-ink-2 h-11 w-full rounded-sm text-[15px] font-medium"
                    >
                      Pay {formatMoney(due, currency, m.locale)}
                    </button>
                    <p className="text-ink-3 mt-2 text-center text-xs">
                      Card, bank debit and local methods via Stripe.
                    </p>
                  </form>
                ) : null}
                {m.payment?.iban ? (
                  <dl className="border-rule mt-6 grid gap-1 border-t pt-4 text-[13px]">
                    <p className="label-caps mb-1">
                      {canPay ? "Or pay by bank transfer" : "Pay by bank transfer"}
                    </p>
                    <dt className="text-ink-3">IBAN</dt>
                    <dd className="figures">{m.payment.iban}</dd>
                    {m.payment.bic ? (
                      <>
                        <dt className="text-ink-3">BIC</dt>
                        <dd className="figures">{m.payment.bic}</dd>
                      </>
                    ) : null}
                    <dt className="text-ink-3">Reference</dt>
                    <dd className="figures">{m.payment.remittance}</dd>
                  </dl>
                ) : null}
              </>
            )}
          </section>
        </div>
        <div className="lg:order-1">
          <DocumentView m={m} logoUrl={null} />
        </div>
      </main>

      {hasFeature(ctx.org.plan, "remove_branding") ? null : (
        <footer className="text-ink-4 flex items-center justify-center gap-2 pb-10 text-xs">
          Sent with <Wordmark className="text-ink-3 text-[13px]" />
        </footer>
      )}
    </div>
  );
}
