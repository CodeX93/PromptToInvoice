"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

const SENTENCE = "3 days of brand design for Halden & Co, €650/day, 19% VAT, net 14";

/**
 * The product in one loop: a sentence is typed, then the invoice typesets
 * itself field by field, each AI-filled value carrying the highlighter mark
 * the real editor uses. Figures are real arithmetic, not decoration.
 * Reduced-motion users see the finished document immediately.
 */
export function TypesetDemo() {
  const [typed, setTyped] = useState(SENTENCE.length);
  const [stage, setStage] = useState(6);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let alive = true;
    const timers: number[] = [];
    const at = (ms: number, fn: () => void) =>
      timers.push(window.setTimeout(() => alive && fn(), ms));
    const loop = () => {
      setTyped(0);
      setStage(0);
      for (let i = 1; i <= SENTENCE.length; i++) at(400 + i * 38, () => setTyped(i));
      const done = 400 + SENTENCE.length * 38 + 350;
      for (let s = 1; s <= 6; s++) at(done + s * 260, () => setStage(s));
      at(done + 6 * 260 + 5200, loop);
    };
    loop();
    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, []);

  const show = (s: number) =>
    cn("transition-opacity duration-300", stage >= s ? "opacity-100" : "opacity-0");
  const mark = (s: number) => (stage >= s ? "ai-mark" : "");

  return (
    <figure aria-label="A sentence becomes an invoice" className="relative">
      <div className="border-ink bg-paper-raised flex min-h-12 items-start gap-3 border px-4 py-3 sm:items-center sm:py-0">
        <span aria-hidden className="text-ink-3 figures">
          ›
        </span>
        <p className="figures min-w-0 flex-1 text-[12.5px] leading-5 sm:truncate">
          {SENTENCE.slice(0, typed)}
          <span
            aria-hidden
            className={cn(
              "bg-ink ml-px inline-block h-4 w-[7px] translate-y-[3px]",
              typed < SENTENCE.length ? "opacity-100" : "animate-pulse",
            )}
          />
        </p>
      </div>

      <div
        aria-hidden
        className="border-rule-strong bg-paper-raised relative mx-3 border-x border-b px-6 pt-7 pb-6 shadow-[0_1px_0_var(--rule),0_18px_40px_-28px_rgb(0_0_0/0.35)] sm:mx-6 sm:px-8"
      >
        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="font-serif text-2xl leading-none">Invoice</p>
            <p className="figures text-ink-3 mt-2 text-xs">INV-2026-0042 · 17 Nov 2026</p>
          </div>
          <div className={cn("text-right text-[13px]", show(1))}>
            <p className="label-caps">Bill to</p>
            <p className="mt-1 whitespace-nowrap">
              <span className={mark(1)}>Halden &amp; Co</span>
            </p>
          </div>
        </div>

        <table className="figures mt-8 w-full text-[12.5px]">
          <thead>
            <tr className="border-ink border-b text-left">
              <th className="label-caps pb-1.5 font-medium">Description</th>
              <th className="label-caps pb-1.5 text-right font-medium">Qty</th>
              <th className="label-caps pb-1.5 text-right font-medium">Rate</th>
              <th className="label-caps pb-1.5 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className={cn("border-rule border-b", show(2))}>
              <td className="py-2 font-sans">
                <span className={mark(2)}>Brand design</span>
              </td>
              <td className="py-2 text-right">
                <span className={mark(2)}>3 days</span>
              </td>
              <td className="py-2 text-right">
                <span className={mark(2)}>650.00</span>
              </td>
              <td className="py-2 text-right">1,950.00</td>
            </tr>
          </tbody>
        </table>

        <dl className="figures mt-4 ml-auto grid w-full max-w-[250px] grid-cols-[1fr_auto] gap-y-1 text-[12.5px]">
          <dt className={cn("text-ink-3", show(3))}>Net</dt>
          <dd className={cn("text-right", show(3))}>1,950.00</dd>
          <dt className={cn("text-ink-3", show(3))}>
            VAT <span className={mark(3)}>19%</span>
          </dt>
          <dd className={cn("text-right", show(3))}>370.50</dd>
          <dt className={cn("rule-double pt-1.5 pb-1 font-sans font-medium", show(4))}>
            Total EUR
          </dt>
          <dd className={cn("rule-double pt-1.5 pb-1 text-right font-medium", show(4))}>
            2,320.50
          </dd>
        </dl>

        <p className={cn("text-ink-3 mt-6 text-xs", show(5))}>
          Due <span className={cn("figures text-ink", mark(5))}>1 Dec 2026</span> (14 days) · IBAN
          DE89 3704 0044 0532 0130 00
        </p>
        <p
          className={cn(
            "border-positive text-positive absolute top-6 right-1/3 hidden -rotate-6 border-2 px-2 py-0.5 text-xs font-semibold tracking-[0.18em] uppercase sm:block",
            show(6),
          )}
        >
          Ready to send
        </p>
      </div>
      <figcaption className="text-ink-3 mt-4 px-3 text-xs sm:px-6">
        Highlighted values came from the sentence. Totals, VAT and the due date are computed, not
        guessed.
      </figcaption>
    </figure>
  );
}
