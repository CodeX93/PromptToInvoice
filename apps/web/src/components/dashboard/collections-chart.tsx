"use client";

import { useState } from "react";
import { formatMoney, type CurrencyCode } from "@pti/core";

/**
 * Single-series bar chart of money collected per month. One measure, one
 * hue (ink), so no legend; values on hover, the latest month labelled, and
 * a visually-hidden table for screen readers.
 */
export function CollectionsChart({ data, currency }: { data: { month: string; amount: number }[]; currency: CurrencyCode }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.amount));
  const W = 640;
  const H = 160;
  const gap = 6;
  const bw = (W - gap * (data.length - 1)) / data.length;
  const label = (m: string) => new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "UTC" }).format(new Date(`${m}-01T00:00:00Z`));
  const active = hover ?? data.length - 1;
  const a = data[active];

  return (
    <figure className="m-0">
      <figcaption className="flex items-baseline justify-between">
        <span className="label-caps">Collected per month · {currency}</span>
        {a ? (
          <span className="figures text-ink-2 text-xs">
            {label(a.month)} {a.month.slice(0, 4)} · <span className="text-ink">{formatMoney(a.amount, currency)}</span>
          </span>
        ) : null}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="mt-3 w-full" role="img" aria-label={`Money collected per month in ${currency}`} onMouseLeave={() => setHover(null)}>
        <line x1={0} x2={W} y1={H} y2={H} stroke="var(--rule-strong)" strokeWidth={1} />
        {data.map((d, i) => {
          const h = d.amount === 0 ? 0 : Math.max(2, (d.amount / max) * (H - 8));
          const slot = i * (bw + gap);
          // Thin marks: the bar takes ~half its slot, centred.
          const mw = Math.max(6, bw * 0.5);
          const x = slot + (bw - mw) / 2;
          const on = i === active;
          return (
            <g key={d.month} onMouseEnter={() => setHover(i)}>
              {/* Hit target taller than the bar. */}
              <rect x={slot} y={0} width={bw + gap} height={H} fill="transparent" />
              <path
                d={h === 0 ? "" : `M${x},${H} v${-(h - 3)} q0,-3 3,-3 h${mw - 6} q3,0 3,3 v${h - 3} z`}
                fill={on ? "var(--ink)" : "var(--ink-4)"}
                style={{ transition: "fill 120ms" }}
              />
              <text x={slot + bw / 2} y={H + 15} textAnchor="middle" fontSize={10} fill={on ? "var(--ink)" : "var(--ink-3)"} fontFamily="var(--font-mono)">
                {label(d.month)}
              </text>
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>Collected per month</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.month}>
              <th scope="row">{d.month}</th>
              <td>{formatMoney(d.amount, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
