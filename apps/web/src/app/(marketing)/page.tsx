import type { Metadata } from "next";
import Link from "next/link";
import {
  CURRENCY_CODES,
  hasFeature,
  PLAN_BLURB,
  PLAN_IDS,
  PLAN_PRICES,
  PLANS,
  SEAT_PRICE,
  type Feature,
  type PlanId,
} from "@pti/core";
import { TypesetDemo } from "@/components/marketing/typeset-demo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { env } from "@/server/env";

export const metadata: Metadata = {
  title: { absolute: "PromptToInvoice — say what you did, send what you're owed" },
  description:
    "Describe the work in a sentence. Get a correct, numbered, VAT-aware invoice with a pay link. For freelancers and small studios in the US and EU.",
};

const STEPS = [
  {
    n: "01",
    title: "Describe it",
    body: "Type or dictate the way you'd say it to a friend: “same as last month for Halden, but 12 hours”. It knows your clients, your usual rates and your default tax.",
  },
  {
    n: "02",
    title: "Check it",
    body: "Everything the model filled in is highlighted, like the marker on a paper draft. VAT IDs are verified against VIES; reverse-charge and exemption notes are suggested from the client's country. Nothing goes out until you say so.",
  },
  {
    n: "03",
    title: "Issue it",
    body: "The number is assigned at the moment of issue, gap-free, per series. The document is then locked; corrections are made with a credit note, the way an auditor expects.",
  },
  {
    n: "04",
    title: "Get paid",
    body: "One email with the PDF and a pay link: card and bank debit through your own Stripe account, or an EPC QR code for a transfer. You see when it's opened, reminders go out on schedule, and payments mark it paid.",
  },
] as const;

const FACTS: [string, string][] = [
  [
    "Money",
    "Integers in minor units, EN 16931 rounding per VAT group. No floating point anywhere near an amount.",
  ],
  [
    "E-invoicing",
    "Factur-X / ZUGFeRD (EN 16931) embedded in a PDF/A-3, and XRechnung CII for German public-sector clients.",
  ],
  [
    "Currencies",
    `${CURRENCY_CODES.length} currencies. ECB rates are frozen on the issue date for VAT reporting in your own currency.`,
  ],
  [
    "Records",
    "Issued documents are immutable at the database level and archived for the statutory retention period.",
  ],
  [
    "Your data",
    "Export every client, invoice and PDF at any time. EU workspaces are stored in the EU.",
  ],
  ["Team", "Owners, admins, members, and a read-only accountant seat with exports."],
];

const ROWS: { label: string; get: (p: PlanId) => string | boolean }[] = [
  {
    label: "Invoices per month",
    get: (p) => PLANS[p].limits.invoicesPerMonth?.toString() ?? "Unlimited",
  },
  {
    label: "AI drafts per month",
    get: (p) => PLANS[p].limits.aiDraftsPerMonth?.toLocaleString("en-US") ?? "Unlimited",
  },
  { label: "People included", get: (p) => PLANS[p].limits.includedSeats?.toString() ?? "Any" },
  { label: "Business profiles", get: (p) => PLANS[p].limits.businessProfiles?.toString() ?? "Any" },
  ...(
    [
      ["all_currencies", "Any currency (Starter: yours, USD, EUR)"],
      ["recurring", "Recurring invoices"],
      ["reminders", "Automatic reminders"],
      ["einvoice", "Factur-X / XRechnung"],
      ["remove_branding", "No PromptToInvoice footer"],
      ["advanced_reports", "Client and revenue reports"],
      ["api", "REST API and webhooks"],
      ["sso", "Single sign-on"],
    ] as [Feature, string][]
  ).map(([f, label]) => ({ label, get: (p: PlanId) => hasFeature(p, f) })),
];

function price(p: PlanId): { figure: string; note: string } {
  if (p === "starter") return { figure: "0", note: "forever" };
  if (p === "enterprise") return { figure: "—", note: "talk to us" };
  return {
    figure: String(PLAN_PRICES[p].month),
    note: `per month, or ${PLAN_PRICES[p].year} a year`,
  };
}

export default function Home() {
  return (
    <main>
      <section className="mx-auto grid max-w-[1180px] grid-cols-[minmax(0,1fr)] items-start gap-14 px-5 pt-16 pb-20 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,560px)] lg:pt-24">
        <div className="lg:pt-6">
          <p className="label-caps">Invoicing for freelancers and small studios · US &amp; EU</p>
          <h1 className="mt-5 font-serif text-[44px] leading-[1.02] tracking-[-0.02em] sm:text-[58px]">
            Say what you did.
            <br />
            <span className="text-ink-3">Send what you&rsquo;re owed.</span>
          </h1>
          <p className="text-ink-2 mt-6 max-w-[34rem] text-[17px] leading-relaxed">
            One sentence becomes a correct, numbered invoice with the right VAT, a due date and a
            way to pay. You review it, you send it, and it gets paid.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button asChild size="lg">
              <Link href="/sign-up">Write your first invoice</Link>
            </Button>
            <Link
              href="/#pricing"
              className="text-ink-2 hover:text-ink decoration-rule-strong text-sm underline underline-offset-4"
            >
              Free for 5 invoices a month. No card.
            </Link>
          </div>
        </div>
        <TypesetDemo />
      </section>

      <section
        id="how"
        className="border-rule-strong mx-auto max-w-[1180px] scroll-mt-8 border-t px-5 pt-14 sm:px-8"
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
          <h2 className="font-serif text-3xl leading-tight">
            From a sentence to paid, in four steps.
          </h2>
          <ol>
            {STEPS.map((s) => (
              <li
                key={s.n}
                className="border-rule grid grid-cols-[48px_minmax(0,1fr)] gap-x-4 border-b py-6 first:pt-0 sm:grid-cols-[64px_200px_minmax(0,1fr)]"
              >
                <span className="figures text-ink-3 text-sm">{s.n}</span>
                <h3 className="font-serif text-xl leading-snug">{s.title}</h3>
                <p className="text-ink-2 col-start-2 mt-2 text-[15px] leading-relaxed sm:col-start-3 sm:mt-0">
                  {s.body}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-[1180px] px-5 pt-20 sm:px-8">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
          <div>
            <h2 className="font-serif text-3xl leading-tight">The dull parts, done properly.</h2>
            <p className="text-ink-3 mt-3 text-sm leading-relaxed">
              An invoice is a legal document first. The AI helps you write it; the rules are
              enforced by code that doesn&rsquo;t guess.
            </p>
          </div>
          <dl className="grid gap-x-10 sm:grid-cols-2">
            {FACTS.map(([k, v]) => (
              <div key={k} className="border-rule border-t py-5">
                <dt className="label-caps">{k}</dt>
                <dd className="mt-2 text-[15px] leading-relaxed">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-[1180px] scroll-mt-8 px-5 pt-24 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="font-serif text-3xl leading-tight">Pricing</h2>
          <p className="text-ink-3 text-sm">
            Same figure in EUR and USD, plus VAT where it applies. Extra people{" "}
            <span className="figures text-ink-2">{SEAT_PRICE.month}</span>/month each.
          </p>
        </div>
        <div className="mt-6 scrollbar-thin overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-[14px]">
            <caption className="sr-only">Plans and what they include</caption>
            <thead>
              <tr className="border-ink border-b-2 align-bottom">
                <th scope="col" className="w-[28%] pb-4 text-left font-normal">
                  <span className="sr-only">Feature</span>
                </th>
                {PLAN_IDS.map((p) => {
                  const pr = price(p);
                  return (
                    <th
                      key={p}
                      scope="col"
                      className={cn(
                        "px-4 pb-4 text-left font-normal",
                        p === "pro" && "bg-paper-sunk",
                      )}
                    >
                      <p className="font-serif text-xl">{PLANS[p].name}</p>
                      <p className="text-ink-3 mt-0.5 text-xs">{PLAN_BLURB[p]}</p>
                      <p className="mt-4 flex items-baseline gap-1.5">
                        <span className="figures text-3xl tracking-tight">{pr.figure}</span>
                        <span className="text-ink-3 text-xs">{pr.note}</span>
                      </p>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.label} className="border-rule border-b">
                  <th scope="row" className="text-ink-2 py-2.5 pr-4 text-left font-normal">
                    {r.label}
                  </th>
                  {PLAN_IDS.map((p) => {
                    const v = r.get(p);
                    return (
                      <td
                        key={p}
                        className={cn("figures px-4 py-2.5", p === "pro" && "bg-paper-sunk")}
                      >
                        {v === true ? (
                          <span aria-label="Included">✓</span>
                        ) : v === false ? (
                          <span aria-label="Not included" className="text-ink-4">
                            —
                          </span>
                        ) : (
                          v
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr>
                <td />
                {PLAN_IDS.map((p) => (
                  <td key={p} className={cn("px-4 pt-5 pb-6", p === "pro" && "bg-paper-sunk")}>
                    {p === "enterprise" ? (
                      <Button asChild variant="secondary" size="sm">
                        <a href="mailto:sales@prompttoinvoice.com">Contact sales</a>
                      </Button>
                    ) : (
                      <Button asChild variant={p === "pro" ? "primary" : "secondary"} size="sm">
                        <Link href="/sign-up">
                          {p === "starter" || env.STRIPE_TRIAL_DAYS === 0
                            ? "Start free"
                            : `Start a ${env.STRIPE_TRIAL_DAYS}-day trial`}
                        </Link>
                      </Button>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="mx-auto max-w-[1180px] px-5 pt-24 sm:px-8">
        <div className="rule-double flex flex-wrap items-end justify-between gap-6 pb-8">
          <p className="max-w-2xl font-serif text-[32px] leading-tight sm:text-[40px]">
            Your next invoice is one sentence away.
          </p>
          <Button asChild size="lg">
            <Link href="/sign-up">Start free</Link>
          </Button>
        </div>
      </section>
    </main>
  );
}
