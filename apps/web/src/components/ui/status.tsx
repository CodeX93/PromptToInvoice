import { DISPLAY_STATUS_LABEL, type DisplayStatus } from "@pti/core";
import { cn } from "@/lib/cn";

/**
 * Invoice status as a typeset mark: a small glyph + small-caps word, like a
 * ledger annotation. Paid gets an actual stamp in the document view; lists
 * stay quiet.
 */
const STYLE: Record<DisplayStatus, { glyph: string; cls: string }> = {
  draft: { glyph: "○", cls: "text-ink-3" },
  issued: { glyph: "◐", cls: "text-ink-2" },
  sent: { glyph: "→", cls: "text-accent" },
  viewed: { glyph: "◉", cls: "text-accent" },
  partially_paid: { glyph: "◑", cls: "text-warning" },
  overdue: { glyph: "!", cls: "text-danger" },
  paid: { glyph: "✓", cls: "text-positive" },
  void: { glyph: "⊘", cls: "text-ink-4 line-through" },
};

export function StatusMark({ status, className }: { status: DisplayStatus; className?: string }) {
  const s = STYLE[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-2xs font-medium tracking-[0.08em] uppercase", s.cls, className)}>
      <span aria-hidden className="figures w-3 text-center text-xs">
        {s.glyph}
      </span>
      {DISPLAY_STATUS_LABEL[status]}
    </span>
  );
}
