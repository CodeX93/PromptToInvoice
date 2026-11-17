"use client";

import { useActionState, useState } from "react";
import { formatDocumentNumber, validateNumberPattern } from "@pti/core";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormFeedback, fieldErrors } from "@/components/ui/form-feedback";
import { initialActionState } from "@/lib/action-state";
import { saveNumbering } from "../actions";

const LABEL = { invoice: "Invoices", credit_note: "Credit notes", quote: "Quotes" } as const;

export function SeriesForm({
  s,
  today,
  canEdit,
}: {
  s: {
    id: string;
    docType: keyof typeof LABEL;
    pattern: string;
    resetPolicy: string;
    next: number;
  };
  today: string;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(saveNumbering, initialActionState);
  const [pattern, setPattern] = useState(s.pattern);
  const issue = validateNumberPattern(pattern);
  const fe = fieldErrors(state);
  return (
    <form
      action={action}
      className="border-rule grid items-end gap-4 border-b py-5 sm:grid-cols-[140px_2fr_1fr_1fr_auto]"
    >
      <input type="hidden" name="seriesId" value={s.id} />
      <p className="font-serif text-base sm:pb-2">{LABEL[s.docType]}</p>
      <Field label="Pattern" error={issue?.message ?? fe.pattern}>
        {(f) => (
          <Input
            id={f.id}
            name="pattern"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            disabled={!canEdit}
            className="figures"
            aria-invalid={f.invalid}
          />
        )}
      </Field>
      <Field label="Resets">
        {(f) => (
          <Select id={f.id} name="resetPolicy" defaultValue={s.resetPolicy} disabled={!canEdit}>
            <option value="yearly">Every year</option>
            <option value="monthly">Every month</option>
            <option value="never">Never</option>
          </Select>
        )}
      </Field>
      <div className="flex flex-col gap-1">
        <span className="label-caps">Next number</span>
        <span className="figures border-rule border-b py-1.5 text-sm">
          {issue ? "—" : formatDocumentNumber(pattern, s.next, today)}
        </span>
      </div>
      {canEdit ? (
        <Button
          type="submit"
          variant="secondary"
          pending={pending}
          disabled={Boolean(issue) || pattern === s.pattern}
        >
          Save
        </Button>
      ) : null}
      <div className="sm:col-span-5">
        <FormFeedback state={state} success={`${LABEL[s.docType]} numbering saved.`} />
      </div>
    </form>
  );
}
