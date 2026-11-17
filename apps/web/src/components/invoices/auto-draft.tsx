"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Route } from "next";
import { draftFromPrompt } from "@/app/app/invoices/ai-actions";

/** Deep link support (/app/invoices/new?prompt=…): drafts once on mount via POST, then replaces the URL. */
export function AutoDraft({ prompt }: { prompt: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void draftFromPrompt(prompt).then((r) => {
      if (r.ok) router.replace(`/app/invoices/${r.data.invoiceId}` as Route);
      else setError(r.error);
    });
  }, [prompt, router]);
  return (
    <div className="mx-auto max-w-xl px-6 py-24">
      <p className="label-caps">Drafting from</p>
      <p className="figures text-ink-2 border-rule mt-2 border-l-2 pl-3 text-[13px] leading-relaxed">
        {prompt}
      </p>
      {error ? (
        <p role="alert" className="text-danger mt-6 text-sm">
          {error}
        </p>
      ) : (
        <div role="status" className="bg-rule relative mt-8 h-px overflow-hidden">
          <span className="bg-ink absolute inset-y-0 left-0 w-1/3 animate-[draft-stroke_1.1s_ease-in-out_infinite]" />
          <span className="sr-only">Drafting your invoice…</span>
        </div>
      )}
    </div>
  );
}
