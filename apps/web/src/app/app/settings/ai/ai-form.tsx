"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormFeedback } from "@/components/ui/form-feedback";
import { initialActionState } from "@/lib/action-state";
import { saveAiSettings } from "./actions";

export function AiForm({ enabled, retainPrompts, canEdit, usage }: { enabled: boolean; retainPrompts: boolean; canEdit: boolean; usage: string }) {
  const [state, action, pending] = useActionState(saveAiSettings, initialActionState);
  return (
    <form action={action} className="flex flex-col gap-5 text-sm">
      <p className="text-ink-3 text-xs">{usage}</p>
      <label className="flex items-start gap-2.5">
        <input type="checkbox" name="enabled" defaultChecked={enabled} disabled={!canEdit} className="accent-ink mt-0.5 size-3.5" />
        <span>
          Draft invoices from plain language
          <span className="text-ink-3 block text-xs">Shows the prompt line at the top of every page.</span>
        </span>
      </label>
      <label className="flex items-start gap-2.5">
        <input type="checkbox" name="retainPrompts" defaultChecked={retainPrompts} disabled={!canEdit} className="accent-ink mt-0.5 size-3.5" />
        <span>
          Keep prompt text for 90 days
          <span className="text-ink-3 block text-xs">Helps diagnose bad drafts. When off, only a fingerprint of each prompt is stored.</span>
        </span>
      </label>
      {canEdit ? (
        <div className="flex items-center gap-4">
          <Button type="submit" variant="secondary" pending={pending}>
            Save
          </Button>
          <FormFeedback state={state} success="AI settings saved." />
        </div>
      ) : null}
    </form>
  );
}
