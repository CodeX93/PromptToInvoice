import type { Metadata } from "next";
import Link from "next/link";
import { Clause, LegalDoc } from "@/components/marketing/legal-doc";
import { env } from "@/server/env";

export const metadata: Metadata = { title: "Terms of service" };

export default function TermsPage() {
  const us = env.LEGAL_ENTITY;
  return (
    <LegalDoc title="Terms of service" updated="2026-11-17">
      <Clause title="Who these terms are between">
        <p>
          These terms are an agreement between {us} (“we”) and the person or business that creates a
          workspace (“you”). If you accept them on behalf of a business, you confirm you may bind
          it. Enterprise customers may have a signed agreement; where it conflicts with these terms,
          the signed agreement wins.
        </p>
      </Clause>
      <Clause title="What the service does, and what it doesn't">
        <p>
          PromptToInvoice helps you prepare, issue, send and collect payment for invoices, quotes
          and credit notes. It suggests tax treatment, wording and values, including with the help
          of a language model.
        </p>
        <p>
          You remain the issuer of every document. Suggestions are not tax or legal advice: check
          each document before you issue it, and ask an adviser when a transaction is unusual.
          Values filled in automatically are highlighted for that reason.
        </p>
      </Clause>
      <Clause title="Your account">
        <ul>
          <li>
            Keep your credentials and API keys secret; activity under them is treated as yours.
          </li>
          <li>Use two-factor authentication if anyone else could reach your email.</li>
          <li>Tell us promptly at {env.LEGAL_EMAIL} if you suspect unauthorised access.</li>
        </ul>
      </Clause>
      <Clause title="Acceptable use">
        <p>You agree not to use the service to:</p>
        <ul>
          <li>
            issue false, fraudulent or misleading invoices, or invoices for unlawful goods or
            services;
          </li>
          <li>send unsolicited email, or email people who have not done business with you;</li>
          <li>probe, overload or work around the security or rate limits of the service;</li>
          <li>resell the service without our written agreement.</li>
        </ul>
        <p>
          We may suspend a workspace that does any of these, and will tell you why unless the law
          prevents it.
        </p>
      </Clause>
      <Clause title="Issued documents are final">
        <p>
          Once issued, a document receives its number and can no longer be edited or deleted; this
          is what tax authorities require of invoice records. Corrections are made by issuing a
          credit note. Issued documents are kept for the statutory retention period (ten years by
          default), including after you close your workspace, and then deleted.
        </p>
      </Clause>
      <Clause title="Plans, payment and cancellation">
        <ul>
          <li>
            Paid plans are billed in advance, monthly or yearly, through Stripe. Prices exclude VAT
            or sales tax, which is added where it applies.
          </li>
          <li>
            You can upgrade, downgrade or cancel at any time from Settings. Cancellation takes
            effect at the end of the paid period; we don't refund partial periods except where the
            law requires it.
          </li>
          <li>
            If a renewal payment fails we keep your plan active while Stripe retries. If the
            subscription ends, the workspace moves to Starter; nothing you created is deleted.
          </li>
          <li>
            We may change prices with at least 30 days' notice; the change applies from your next
            renewal.
          </li>
        </ul>
      </Clause>
      <Clause title="Payments you collect">
        <p>
          Card and bank-debit payments from your clients are processed by Stripe under your own
          connected Stripe account and Stripe's terms. We never hold your clients' funds. Disputes
          and refunds are between you, your client and Stripe.
        </p>
      </Clause>
      <Clause title="Your content">
        <p>
          You own your data: clients, documents, prompts and files. You give us permission to host,
          process and transmit it only as needed to run the service for you. We do not use your
          content to train models. You can export everything at any time from Settings → Data &amp;
          privacy. How we handle personal data is described in the{" "}
          <Link href="/legal/privacy" className="underline underline-offset-4">
            privacy notice
          </Link>
          .
        </p>
      </Clause>
      <Clause title="Availability and changes">
        <p>
          We work to keep the service available and your data safe, with encrypted transport,
          encrypted bank details at rest, tenant isolation enforced in the database, and backups. We
          may change or remove features; if a change materially reduces what a paid plan includes,
          we'll give you notice and the option to cancel with a pro-rata refund.
        </p>
      </Clause>
      <Clause title="Liability">
        <p>
          Nothing in these terms limits liability that cannot be limited by law, including for
          intent, gross negligence or injury. Otherwise, our total liability in any 12 months is
          limited to the fees you paid us in that period, and neither party is liable for indirect
          or consequential loss, such as lost profit.
        </p>
      </Clause>
      <Clause title="Ending the agreement">
        <p>
          You can close your workspace at any time from Settings. We may end the agreement with 30
          days' notice, or immediately for a serious breach. Either way you keep access to export
          your data for 30 days, except where the breach makes that unsafe.
        </p>
      </Clause>
      <Clause title="Law and changes to these terms">
        <p>
          These terms are governed by the law of the country where {us} is established, without
          prejudice to the mandatory consumer protections of your country of residence. We'll give
          30 days' notice of material changes by email; continuing to use the service after that
          means you accept them.
        </p>
      </Clause>
    </LegalDoc>
  );
}
