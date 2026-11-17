"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type SubmitEvent } from "react";
import type { Route } from "next";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { cn } from "@/lib/cn";
import { toast } from "@/components/ui/toast";
import { draftFromPrompt } from "@/app/app/invoices/ai-actions";

const EXAMPLES = [
  "10h consulting for Acme Corp at $120/h, due in 30 days",
  "Logo design for Halden & Co, €1,800 flat, 19% VAT",
  "Same as last month for Nordlicht GmbH",
  "3 days on-site workshop for Brightline Ltd, £650/day plus travel £214.50",
];

/**
 * The product's core gesture lives in the chrome: a command line that turns
 * a sentence into a draft. ⌘K or "/" focuses it from anywhere.
 */
export function PromptBar({ aiEnabled }: { aiEnabled: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  // Rotate the example after hydration (server and browser may disagree on the date).
  useEffect(() => {
    if (input.current)
      input.current.placeholder = EXAMPLES[new Date().getDate() % EXAMPLES.length] ?? "";
  }, []);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [drafting, startDraft] = useTransition();

  useHotkeys({
    "mod+k": () => input.current?.focus(),
    "/": () => input.current?.focus(),
    c: () => router.push("/app/invoices/new"),
    "g i": () => router.push("/app/invoices"),
    "g c": () => router.push("/app/clients"),
    "g d": () => router.push("/app"),
    "g s": () => router.push("/app/settings"),
  });

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const text = value.trim();
    if (!text) return;
    if (!aiEnabled) {
      router.push(`/app/invoices?q=${encodeURIComponent(text)}` as Route);
      setValue("");
      return;
    }
    startDraft(async () => {
      const r = await draftFromPrompt(text);
      if (!r.ok) {
        toast.error(r.error);
        return;
      }
      setValue("");
      input.current?.blur();
      router.push(`/app/invoices/${r.data.invoiceId}` as Route);
    });
  }

  return (
    <form
      onSubmit={submit}
      role="search"
      aria-label="Draft an invoice from a description"
      className="relative"
    >
      <label
        className={cn(
          "flex h-12 items-center gap-3 border-b px-6 transition-colors",
          focused ? "border-ink bg-paper-raised" : "border-rule",
        )}
      >
        <span aria-hidden className="figures text-ink-3 text-sm">
          ›
        </span>
        <span className="sr-only">{aiEnabled ? "Describe the work to invoice" : "Search invoices"}</span>
        <input
          ref={input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") input.current?.blur();
          }}
          placeholder={aiEnabled ? EXAMPLES[0] : "Search invoices by number, client or reference"}
          maxLength={2000}
          readOnly={drafting}
          aria-busy={drafting}
          className={cn("figures placeholder:text-ink-4 h-full flex-1 bg-transparent text-[13px] outline-none", drafting && "text-ink-3")}
          autoComplete="off"
          spellCheck={false}
        />
        {drafting ? (
          <span role="status" className="figures text-ink-3 text-2xs">drafting…</span>
        ) : value ? (
          <kbd className="figures text-ink-3 text-2xs">↵ {aiEnabled ? "draft" : "search"}</kbd>
        ) : (
          <kbd className="figures text-ink-4 text-2xs">⌘K</kbd>
        )}
      </label>
      {/* Ruled progress line: an indeterminate pen stroke along the bar's bottom edge. */}
      {drafting ? <span aria-hidden className="bg-ink absolute bottom-0 left-0 h-px w-1/3 animate-[draft-stroke_1.1s_ease-in-out_infinite]" /> : null}
    </form>
  );
}
