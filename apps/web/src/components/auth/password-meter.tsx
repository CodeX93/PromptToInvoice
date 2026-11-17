"use client";

import { cn } from "@/lib/cn";

/**
 * Cheap, honest strength estimate: length dominates, character variety
 * helps, obvious patterns hurt. Guides people toward passphrases.
 */
export function scorePassword(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (pw.length < 10) return 0;
  let s = pw.length >= 16 ? 2 : 1;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/, /\s/].filter((r) => r.test(pw)).length;
  if (classes >= 3) s++;
  if (pw.length >= 20) s++;
  if (/(.)\1{3,}|0123|1234|abcd|qwer|password|invoice/i.test(pw)) s--;
  return Math.max(0, Math.min(4, s)) as 0 | 1 | 2 | 3 | 4;
}

const LABELS = ["Too short", "Weak", "Fair", "Good", "Strong"] as const;

export function PasswordMeter({ value }: { value: string }) {
  const score = scorePassword(value);
  if (!value)
    return (
      <p className="text-ink-3 text-xs">At least 10 characters. A short sentence works well.</p>
    );
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      <div className="flex flex-1 gap-1">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn(
              "h-0.5 flex-1 transition-colors",
              i <= score
                ? score <= 1
                  ? "bg-danger"
                  : score === 2
                    ? "bg-warning"
                    : "bg-positive"
                : "bg-rule",
            )}
          />
        ))}
      </div>
      <span className="text-ink-3 w-16 text-right text-xs">{LABELS[score]}</span>
    </div>
  );
}
