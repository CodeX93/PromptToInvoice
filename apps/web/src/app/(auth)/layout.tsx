import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand/wordmark";

/**
 * Auth pages: form on the right, and on the left the product's promise shown
 * literally — a line of plain text and the invoice it becomes.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.1fr)_minmax(420px,0.9fr)]">
      <aside className="border-rule bg-paper-sunk relative hidden overflow-hidden border-r lg:block">
        <div className="flex h-full flex-col justify-between p-12">
          <Link href="/" className="text-xl">
            <Wordmark />
          </Link>
          <Specimen />
          <p className="text-ink-3 max-w-sm text-xs leading-relaxed">
            EU and US ready: VAT, reverse charge, multi-currency, gap-free numbering and e-invoices built in.
          </p>
        </div>
      </aside>
      <main className="flex flex-col px-4 py-10 sm:px-10">
        <Link href="/" className="mb-12 text-lg lg:hidden">
          <Wordmark />
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">{children}</div>
      </main>
    </div>
  );
}

function Specimen() {
  const rows = [
    ["Strategy workshop", "1 day", "1,200.00"],
    ["Implementation", "16 h", "1,920.00"],
    ["Hosting, Nov", "1", "120.00"],
  ] as const;
  return (
    <div className="mx-auto w-full max-w-lg">
      <p className="figures text-ink-2 mb-6 text-[13px] leading-relaxed">
        <span className="text-ink-4">›</span> workshop + 16h build for Halden &amp; Co at €120/h, hosting €120, due in 14
        days<span className="bg-ink ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] animate-pulse" />
      </p>
      <div className="border-rule-strong bg-paper-raised shadow-pop -rotate-[0.6deg] rounded-xs border px-8 py-7">
        <div className="flex items-start justify-between">
          <div>
            <p className="label-caps">Invoice</p>
            <p className="mt-1 font-serif text-2xl">INV-2026-0042</p>
          </div>
          <p className="text-ink-3 text-right text-xs leading-relaxed">
            Halden &amp; Co
            <br />
            Due 1 Dec 2026
          </p>
        </div>
        <table className="mt-7 w-full text-[13px]">
          <tbody>
            {rows.map(([d, q, a]) => (
              <tr key={d} className="border-rule border-b">
                <td className="py-2">
                  <span className="ai-mark">{d}</span>
                </td>
                <td className="figures text-ink-3 py-2 text-right">{q}</td>
                <td className="figures py-2 text-right">{a}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 ml-auto w-56 text-[13px]">
          <div className="text-ink-3 flex justify-between py-0.5">
            <span>VAT 19%</span>
            <span className="figures">616.80</span>
          </div>
          <div className="rule-double flex justify-between pt-2 pb-1 font-medium">
            <span>Total EUR</span>
            <span className="figures">3,856.80</span>
          </div>
        </div>
      </div>
    </div>
  );
}
