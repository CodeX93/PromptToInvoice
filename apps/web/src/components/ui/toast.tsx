"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";

/**
 * Minimal toast queue: module-level store + useSyncExternalStore. No
 * context provider, no dependency; toasts are announced via aria-live.
 */
type Tone = "neutral" | "success" | "error";
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function toast(message: string, tone: Tone = "neutral", ms = 4200): void {
  const id = ++seq;
  toasts = [...toasts.slice(-3), { id, message, tone }];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    emit();
  }, ms);
}
toast.success = (m: string) => {
  toast(m, "success");
};
toast.error = (m: string) => {
  toast(m, "error", 6000);
};

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
const snapshot = () => toasts;
const empty: Toast[] = [];

export function Toaster() {
  const items = useSyncExternalStore(subscribe, snapshot, () => empty);
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          role={t.tone === "error" ? "alert" : "status"}
          className={cn(
            "bg-ink text-paper pointer-events-auto flex items-start gap-2.5 rounded-sm px-3.5 py-2.5 text-sm",
            "shadow-pop animate-[rise-in_160ms_ease-out]",
          )}
        >
          <span aria-hidden className={cn("figures mt-px", t.tone === "error" ? "text-[#f08a6d]" : t.tone === "success" ? "text-[#7fc08d]" : "text-paper/60")}>
            {t.tone === "error" ? "!" : t.tone === "success" ? "✓" : "·"}
          </span>
          <span className="leading-snug">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
