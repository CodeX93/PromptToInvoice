import { cn } from "@/lib/cn";

/** "prompt→Invoice": the product in one line — typed input becomes a typeset document. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn("text-ink inline-flex items-baseline select-none", className)}
      aria-label="PromptToInvoice"
    >
      <span className="figures text-[0.82em] font-medium tracking-tight">prompt</span>
      <span aria-hidden className="text-ink-3 mx-[0.12em] font-serif text-[0.9em] italic">
        to
      </span>
      <span className="font-serif text-[1.05em] font-medium tracking-[-0.015em]">Invoice</span>
    </span>
  );
}
