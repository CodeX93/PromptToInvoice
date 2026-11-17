import { formatMoney, type CurrencyCode } from "@pti/core";
import { cn } from "@/lib/cn";

/** Monospaced tabular amount; negative values are shown in parentheses-free minus with danger tint when asked. */
export function Money({
  minor,
  currency,
  locale = "en-US",
  className,
  signed,
}: {
  minor: number;
  currency: CurrencyCode;
  locale?: string;
  className?: string;
  signed?: boolean;
}) {
  return (
    <span className={cn("figures whitespace-nowrap", signed && minor < 0 && "text-danger", className)}>
      {formatMoney(minor, currency, locale)}
    </span>
  );
}
