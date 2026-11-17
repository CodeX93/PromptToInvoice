"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type SubmitEvent } from "react";
import type { Route } from "next";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { useDictation } from "@/hooks/use-dictation";
import { cn } from "@/lib/cn";
import { toast } from "@/components/ui/toast";
import { errorToast } from "@/lib/action-state";
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
  const dictation = useDictation((text) => setValue(text));

  useHotkeys({
    "mod+k": () => input.current?.focus(),
    "/": () => input.current?.focus(),
    c: () => router.push("/app/invoices/new"),
    "g i": () => router.push("/app/invoices"),
    "g c": () => router.push("/app/clients"),
    "g q": () => router.push("/app/quotes"),
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
        errorToast(r, toast);
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
        <span className="sr-only">
          {aiEnabled ? "Describe the work to invoice" : "Search invoices"}
        </span>
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
          className={cn(
            "figures placeholder:text-ink-4 h-full flex-1 bg-transparent text-[13px] outline-none",
            drafting && "text-ink-3",
          )}
          autoComplete="off"
          spellCheck={false}
        />
        {aiEnabled && dictation.supported && !drafting ? (
          <button
            type="button"
            onClick={dictation.listening ? dictation.stop : dictation.start}
            aria-pressed={dictation.listening}
            aria-label={
              dictation.listening
                ? "Stop dictation"
                : "Dictate (your browser's speech service transcribes the audio)"
            }
            title="Dictate — transcribed by your browser's speech service"
            className={cn(
              "text-ink-3 hover:text-ink grid size-6 place-items-center rounded-full",
              dictation.listening && "bg-danger-soft text-danger animate-pulse",
            )}
          >
            <svg
              width="12"
              height="14"
              viewBox="0 0 12 14"
              aria-hidden
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
            >
              <rect x="3.5" y="0.75" width="5" height="8" rx="2.5" />
              <path d="M1 6.5a5 5 0 0 0 10 0M6 11.5v2" />
            </svg>
          </button>
        ) : null}
        {drafting ? (
          <span role="status" className="figures text-ink-3 text-2xs">
            drafting…
          </span>
        ) : value ? (
          <kbd className="figures text-ink-3 text-2xs">↵ {aiEnabled ? "draft" : "search"}</kbd>
        ) : (
          <kbd className="figures text-ink-4 text-2xs">⌘K</kbd>
        )}
      </label>
      {/* Ruled progress line: an indeterminate pen stroke along the bar's bottom edge. */}
      {drafting ? (
        <span
          aria-hidden
          className="bg-ink absolute bottom-0 left-0 h-px w-1/3 animate-[draft-stroke_1.1s_ease-in-out_infinite]"
        />
      ) : null}
    </form>
  );
}
