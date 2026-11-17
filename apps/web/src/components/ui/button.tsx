import { Slot } from "@radix-ui/react-slot";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "link";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium select-none " +
  "transition-[background-color,border-color,color,transform] duration-150 ease-snap " +
  "disabled:pointer-events-none disabled:opacity-45 active:translate-y-px";

const variants: Record<Variant, string> = {
  // Ink on paper: the primary action looks like a stamp, not a gradient pill.
  primary: "bg-ink text-paper hover:bg-ink-2 rounded-sm",
  secondary:
    "border border-rule-strong bg-paper-raised text-ink hover:border-ink-3 hover:bg-paper rounded-sm",
  ghost: "text-ink-2 hover:text-ink hover:bg-paper-sunk rounded-sm",
  danger: "border border-danger/40 text-danger hover:bg-danger-soft rounded-sm",
  link: "text-ink underline decoration-rule-strong underline-offset-4 hover:decoration-ink px-0! h-auto!",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs",
  md: "h-9 px-3.5 text-sm",
  lg: "h-11 px-5 text-[15px]",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  asChild?: boolean;
  /** Shows an inline progress indicator and disables the button. */
  pending?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", asChild, pending, disabled, children, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      className={cn(base, variants[variant], sizes[size], className)}
      disabled={disabled ?? pending}
      aria-busy={pending ?? undefined}
      {...props}
    >
      {pending ? <Dots /> : null}
      {children}
    </Comp>
  );
});

/** Three ticking dots — a typewriter cursor rather than a generic spinner. */
function Dots() {
  return (
    <span aria-hidden className="inline-flex gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1 animate-pulse rounded-full bg-current"
          style={{ animationDelay: `${i * 160}ms` }}
        />
      ))}
    </span>
  );
}
