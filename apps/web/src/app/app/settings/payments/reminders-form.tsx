"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormFeedback } from "@/components/ui/form-feedback";
import { initialActionState } from "@/lib/action-state";
import { saveReminders } from "./actions";

const CHOICES = [
  { v: -7, label: "7 days before due" },
  { v: -3, label: "3 days before due" },
  { v: 0, label: "On the due date" },
  { v: 3, label: "3 days overdue" },
  { v: 10, label: "10 days overdue" },
  { v: 30, label: "30 days overdue" },
];

export function RemindersForm({
  enabled,
  offsets,
  allowed,
  canEdit,
}: {
  enabled: boolean;
  offsets: number[];
  allowed: boolean;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(saveReminders, initialActionState);
  if (!allowed)
    return (
      <p className="text-ink-3 text-sm">Automatic reminders are part of the Professional plan.</p>
    );
  return (
    <form action={action} className="flex flex-col gap-4 text-sm">
      <label className="flex items-center gap-2.5">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={enabled}
          disabled={!canEdit}
          className="accent-ink size-3.5"
        />
        Email clients about unpaid invoices automatically
      </label>
      <fieldset className="grid grid-cols-2 gap-2 pl-6 sm:grid-cols-3" disabled={!canEdit}>
        <legend className="label-caps mb-2">Send a reminder</legend>
        {CHOICES.map((c) => (
          <label key={c.v} className="text-ink-2 flex items-center gap-2">
            <input
              type="checkbox"
              name="offset"
              value={c.v}
              defaultChecked={offsets.includes(c.v)}
              className="accent-ink size-3.5"
            />
            {c.label}
          </label>
        ))}
      </fieldset>
      {canEdit ? (
        <div className="flex items-center gap-4">
          <Button type="submit" variant="secondary" pending={pending}>
            Save
          </Button>
          <FormFeedback state={state} success="Reminder schedule saved." />
        </div>
      ) : null}
    </form>
  );
}
