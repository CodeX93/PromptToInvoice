"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type SubmitEvent } from "react";
import type { Route } from "next";
import { useHotkeys } from "@/hooks/use-hotkeys";
import { cn } from "@/lib/cn";

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
    if (input.current) input.current.placeholder = EXAMPLES[new Date().getDate() % EXAMPLES.length] ?? "";
  }, []);
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);

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
    router.push(`/app/invoices/new?prompt=${encodeURIComponent(text)}` as Route);
    setValue("");
    input.current?.blur();
  }

  if (!aiEnabled) return <div className="h-12" />;

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
        <span className="sr-only">Describe the work to invoice</span>
        <input
          ref={input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") input.current?.blur();
          }}
          placeholder={EXAMPLES[0]}
          maxLength={2000}
          className="figures placeholder:text-ink-4 h-full flex-1 bg-transparent text-[13px] outline-none"
          autoComplete="off"
          spellCheck={false}
        />
        {value ? (
          <kbd className="figures text-ink-3 text-2xs">↵ draft</kbd>
        ) : (
          <kbd className="figures text-ink-4 text-2xs">⌘K</kbd>
        )}
      </label>
    </form>
  );
}
