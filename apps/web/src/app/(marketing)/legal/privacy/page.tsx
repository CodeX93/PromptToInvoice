import type { Metadata } from "next";
import { Clause, LegalDoc } from "@/components/marketing/legal-doc";
import { env } from "@/server/env";

export const metadata: Metadata = { title: "Privacy notice" };

const PROCESSORS: [string, string, string][] = [
  ["Hosting and database", "Application, database and file storage", "EU region for EU workspaces"],
  ["Stripe", "Subscription billing; payments you collect via Stripe Connect", "EU / US (SCCs)"],
  ["Email delivery provider", "Sending invoices, reminders and account email", "EU / US (SCCs)"],
  [
    "Anthropic",
    "Turning your prompt into a draft invoice (text you type only)",
    "US (SCCs); no training on your data",
  ],
  ["European Commission (VIES)", "Checking a client's EU VAT number when you ask", "EU"],
];

export default function PrivacyPage() {
  return (
    <LegalDoc title="Privacy notice" updated="2026-11-17">
      <Clause title="Two roles">
        <p>
          For your own account (name, email, sign-in and billing details), {env.LEGAL_ENTITY} is the
          controller. For the data you put into invoices, mainly your clients' names, addresses,
          email addresses and VAT numbers, you are the controller and we are your processor, acting
          only on your instructions. These terms work as the data processing agreement under Art. 28
          GDPR; Enterprise customers can sign a separate one.
        </p>
      </Clause>
      <Clause title="What we collect">
        <ul>
          <li>
            <strong className="text-ink font-medium">Account:</strong> name, email, password hash,
            two-factor settings, time zone, language.
          </li>
          <li>
            <strong className="text-ink font-medium">Workspace:</strong> business details, bank
            details (encrypted at rest), tax settings, members and roles.
          </li>
          <li>
            <strong className="text-ink font-medium">Documents:</strong> clients, invoices, quotes,
            payments and the prompts you write.
          </li>
          <li>
            <strong className="text-ink font-medium">Usage and security:</strong> IP address and
            user agent on sign-in and sensitive actions, an audit log of changes, and error logs. No
            advertising trackers, no third-party analytics.
          </li>
          <li>
            <strong className="text-ink font-medium">Client page:</strong> when your client opens an
            invoice link we record that it was viewed, so you know. We don't set tracking cookies on
            that page.
          </li>
        </ul>
      </Clause>
      <Clause title="Why, and on what basis">
        <ul>
          <li>To provide the service you signed up for (contract, Art. 6(1)(b)).</li>
          <li>
            To keep invoice records for the period tax law requires (legal obligation, Art.
            6(1)(c)).
          </li>
          <li>
            To secure the service, prevent abuse and fix errors (legitimate interest, Art. 6(1)(f)).
          </li>
          <li>
            To email you about your account and material changes. We send marketing only if you opt
            in.
          </li>
        </ul>
      </Clause>
      <Clause title="Who processes it for us">
        <div className="scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[520px] text-[13px]">
            <thead>
              <tr className="border-ink border-b text-left">
                <th className="label-caps py-2 pr-4 font-medium">Processor</th>
                <th className="label-caps py-2 pr-4 font-medium">Purpose</th>
                <th className="label-caps py-2 font-medium">Where</th>
              </tr>
            </thead>
            <tbody>
              {PROCESSORS.map(([who, why, where]) => (
                <tr key={who} className="border-rule border-b align-top">
                  <td className="text-ink py-2 pr-4">{who}</td>
                  <td className="py-2 pr-4">{why}</td>
                  <td className="py-2">{where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p>
          AI drafting can be switched off for a workspace in Settings → AI, in which case nothing is
          sent to the model provider. We do not sell personal data.
        </p>
      </Clause>
      <Clause title="How long we keep it">
        <ul>
          <li>
            Issued invoices, credit notes and their PDFs: the statutory retention period (ten years
            by default), then deleted automatically.
          </li>
          <li>
            Drafts, clients without issued documents, and account data: until you delete them or
            close the workspace.
          </li>
          <li>
            The text of AI prompts: replaced by a one-way hash after 90 days; the draft it produced
            is kept like any other document.
          </li>
          <li>
            Sign-in sessions: deleted a week after they expire. The audit log of changes is kept for
            as long as the workspace exists.
          </li>
          <li>Webhook delivery logs: 30 days.</li>
          <li>Data exports you request: deleted after seven days.</li>
        </ul>
      </Clause>
      <Clause title="Your rights">
        <p>
          You can access, correct, export and delete your data. Most of this is self-service:
          Settings → Data &amp; privacy exports everything as CSV and PDFs, and Settings → Account
          &amp; security deletes your account. Data we must retain by law is kept locked and out of
          use until the retention period ends. For anything else, or to object to processing, write
          to{" "}
          <a className="underline underline-offset-4" href={`mailto:${env.LEGAL_EMAIL}`}>
            {env.LEGAL_EMAIL}
          </a>
          . You can also complain to your data protection authority.
        </p>
        <p>
          If you are a client of one of our customers, your invoice data belongs to them; please
          contact the business that invoiced you, and we'll help them answer.
        </p>
      </Clause>
      <Clause title="Cookies">
        <p>
          We use only cookies that are needed to sign you in, keep the session secure and remember
          your light/dark preference. There's nothing to consent to and nothing to opt out of.
        </p>
      </Clause>
      <Clause title="Security">
        <p>
          Traffic is encrypted with TLS; bank details and secrets are encrypted at the application
          layer; each workspace is isolated by row-level security in the database; passwords are
          hashed; two-factor authentication is available to everyone. If a breach affects your data
          we'll notify you without undue delay.
        </p>
      </Clause>
    </LegalDoc>
  );
}
