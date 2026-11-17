import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/cn";

/**
 * Form controls. Inputs sit on a single bottom rule like a paper form
 * rather than in boxed cards; focus draws the rule in ink.
 */

const control =
  "w-full bg-transparent text-ink placeholder:text-ink-4 border-0 border-b border-rule-strong " +
  "px-0 py-1.5 text-sm outline-none transition-colors duration-150 " +
  "hover:border-ink-3 focus:border-ink focus-visible:outline-none " +
  "aria-[invalid=true]:border-danger disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(control, "h-9", className)} {...props} />;
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, rows = 3, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(control, "resize-y leading-relaxed", className)}
      {...props}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={cn(
          control,
          "h-9 cursor-pointer appearance-none bg-[length:10px] bg-[right_2px_center] bg-no-repeat pr-5",
          "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%237f7a6b' stroke-width='1.3'/%3E%3C/svg%3E\")]",
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);

export interface FieldProps {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | string[] | undefined;
  /** Render prop receives ids for aria wiring. */
  children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  className?: string;
  optional?: boolean;
}

export function Field({ label, hint, error, children, className, optional }: FieldProps) {
  const id = useId();
  const msg = Array.isArray(error) ? error[0] : error;
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = msg ? `${id}-err` : undefined;
  const describedBy = [errId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="label-caps flex items-baseline justify-between">
        <span className="flex flex-1">{label}</span>
        {optional ? <span className="text-ink-4 tracking-normal normal-case">optional</span> : null}
      </label>
      {children({ id, describedBy, invalid: Boolean(msg) })}
      {msg ? (
        <p id={errId} className="text-danger text-xs" role="alert">
          {msg}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-ink-3 text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
