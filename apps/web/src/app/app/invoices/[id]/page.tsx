import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { amountDue, can as canDo, hasFeature, formatMoney, fromMinor, todayIn } from "@pti/core";
import { DocumentView } from "@/components/invoices/document-view";
import { InvoiceActions } from "@/components/invoices/invoice-actions";
import { InvoiceEditor } from "@/components/invoices/invoice-editor";
import { StatusMark } from "@/components/ui/status";
import { NotFound } from "@/server/errors";
import { requireOrg, can } from "@/server/session";
import { getInvoice } from "@/server/services/invoices";
import { editorProps } from "@/server/services/editor-props";
import { aiMarksFor } from "@/server/services/ai-drafts";
import { modelFor, publicUrl } from "@/server/documents/service";

export async function generateMetadata(props: PageProps<"/app/invoices/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  return { title: `Invoice ${id.slice(0, 8)}` };
}

const EVENT_LABEL: Record<string, string> = {
  created: "Draft created",
  issued: "Issued",
  sent: "Sent to client",
  viewed: "Viewed by client",
  reminder_sent: "Reminder sent",
  payment_recorded: "Payment recorded",
  payment_refunded: "Payment refunded",
  paid: "Paid in full",
  voided: "Voided by credit note",
  credited: "Partially credited",
  email_bounced: "Email bounced",
  pdf_rendered: "PDF archived",
};

export default async function InvoicePage(props: PageProps<"/app/invoices/[id]">) {
  const ctx = await requireOrg();
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const detail = await getInvoice(ctx, id).catch((e: unknown) => {
    if (e instanceof NotFound) notFound();
    throw e;
  });

  if (detail.invoice.status === "draft" && can(ctx, "invoice:write")) {
    const marks = await aiMarksFor(ctx, detail.invoice.aiDraftId, detail.invoice.version);
    return (
      <InvoiceEditor
        {...await editorProps(ctx, detail, { aiFields: marks?.fields, aiNotes: marks?.notes })}
      />
    );
  }

  const inv = detail.invoice;
  const model = await modelFor(ctx, detail);
  const currency = model.currency;
  const due = amountDue(inv);
  const fmtTime = new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: ctx.user.timeZone,
  });

  return (
    <div className="pb-20">
      <div className="border-rule flex flex-wrap items-center gap-3 border-b px-6 py-2.5 lg:px-10">
        <Link href="/app/invoices" className="text-ink-3 hover:text-ink text-[13px]">
          ← Invoices
        </Link>
        <span className="text-ink-4">/</span>
        <span className="figures text-[13px]">{inv.number}</span>
        <StatusMark status={detail.status} className="ml-2" />
        <div className="ml-auto">
          <InvoiceActions
            id={inv.id}
            docType={inv.docType}
            publicUrl={publicUrl(inv.publicToken)}
            canPay={can(ctx, "payment:write") && canDo(inv, "record_payment")}
            canCredit={canDo(inv, "credit")}
            canWrite={can(ctx, "invoice:write")}
            amountDue={formatMoney(due, currency)}
            amountDueRaw={fromMinor(due, currency)}
            today={todayIn(ctx.org.timeZone)}
            number={inv.number ?? ""}
            canSend={can(ctx, "invoice:send") && canDo(inv, "send")}
            sentBefore={Boolean(inv.sentAt)}
            clientEmails={detail.client?.emails ?? []}
            canRepeat={
              inv.docType === "invoice" &&
              can(ctx, "invoice:write") &&
              hasFeature(ctx.org.plan, "recurring")
            }
            canEinvoice={hasFeature(ctx.org.plan, "einvoice")}
          />
        </div>
      </div>

      <div className="mx-auto grid max-w-[1180px] gap-8 px-4 pt-8 sm:px-6 xl:grid-cols-[minmax(0,1fr)_280px]">
        <DocumentView
          m={model}
          logoUrl={model.logoFileId ? `/api/files/${model.logoFileId}` : null}
        />

        <aside className="flex flex-col gap-8 text-[13px] xl:sticky xl:top-20 xl:self-start">
          <section>
            <p className="label-caps">{inv.docType === "invoice" ? "Amount due" : "Credit"}</p>
            <p className="figures mt-1 text-2xl">
              {formatMoney(inv.docType === "invoice" ? due : inv.total, currency)}
            </p>
            {inv.docType === "invoice" && due !== inv.total && inv.status !== "void" ? (
              <p className="figures text-ink-3 text-xs">of {formatMoney(inv.total, currency)}</p>
            ) : null}
            {detail.client ? (
              <Link
                href={`/app/clients/${detail.client.id}` as Route}
                className="text-ink-2 hover:text-ink mt-3 block underline-offset-4 hover:underline"
              >
                {detail.client.name} →
              </Link>
            ) : null}
          </section>

          {detail.corrects ? (
            <section>
              <p className="label-caps mb-1">Corrects</p>
              <Link
                href={`/app/invoices/${detail.corrects.id}` as Route}
                className="figures underline underline-offset-4"
              >
                {detail.corrects.number}
              </Link>
            </section>
          ) : null}

          {detail.credits.length ? (
            <section>
              <p className="label-caps mb-1">Credit notes</p>
              {detail.credits.map((c) => (
                <Link
                  key={c.id}
                  href={`/app/invoices/${c.id}` as Route}
                  className="figures flex justify-between py-0.5 hover:underline"
                >
                  <span>{c.number ?? "Draft"}</span>
                  <span>{formatMoney(c.total, currency)}</span>
                </Link>
              ))}
            </section>
          ) : null}

          {detail.payments.length ? (
            <section>
              <p className="label-caps mb-1">Payments</p>
              {detail.payments.map((p) => (
                <div key={p.id} className="border-rule flex justify-between border-b py-1.5">
                  <span className="text-ink-2">
                    {p.receivedOn} · {p.method.replace("_", " ")}
                  </span>
                  <span className="figures">{formatMoney(p.amount, currency)}</span>
                </div>
              ))}
            </section>
          ) : null}

          <section>
            <p className="label-caps mb-2">History</p>
            <ol className="border-rule relative ml-1 border-l">
              {detail.events.map((e) => (
                <li key={e.id} className="relative pb-3 pl-4">
                  <span className="bg-paper border-ink-3 absolute top-1.5 -left-[4px] size-[7px] rounded-full border" />
                  <p>{EVENT_LABEL[e.type] ?? e.type}</p>
                  <p className="text-ink-3 text-2xs">
                    {fmtTime.format(e.createdAt)}
                    {e.actorName ? ` · ${e.actorName}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}
