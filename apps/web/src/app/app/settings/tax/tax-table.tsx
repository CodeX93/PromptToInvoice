"use client";

import { useActionState, useState, useTransition } from "react";
import { TAX_CATEGORIES, TAX_CATEGORY_LABEL, type TaxCategory } from "@pti/core";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormFeedback, fieldErrors } from "@/components/ui/form-feedback";
import { toast } from "@/components/ui/toast";
import { initialActionState } from "@/lib/action-state";
import { addTaxRate, archive, makeDefault } from "./actions";

export interface TaxRateRow {
  id: string;
  name: string;
  category: TaxCategory;
  rate: string;
  isDefault: boolean;
  note: string | null;
}

export function TaxTable({ rows, canEdit }: { rows: TaxRateRow[]; canEdit: boolean }) {
  const [pending, start] = useTransition();
  const [state, action, adding] = useActionState(addTaxRate, initialActionState);
  const [category, setCategory] = useState<TaxCategory>("S");
  const fe = fieldErrors(state);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? "Failed");
    });

  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-rule-strong border-b text-left">
            <th className="label-caps py-2 font-medium">Name</th>
            <th className="label-caps py-2 font-medium">Category</th>
            <th className="label-caps py-2 text-right font-medium">Rate</th>
            <th className="w-40" />
          </tr>
        </thead>
        <tbody aria-busy={pending}>
          {rows.map((r) => (
            <tr key={r.id} className="border-rule border-b">
              <td className="py-2.5">
                {r.name}
                {r.isDefault ? (
                  <span className="text-ink-3 text-2xs ml-2 tracking-[0.08em] uppercase">
                    default
                  </span>
                ) : null}
                {r.note ? (
                  <p className="text-ink-3 mt-0.5 max-w-md truncate text-xs">{r.note}</p>
                ) : null}
              </td>
              <td className="text-ink-2 py-2.5">
                <span className="figures text-ink-3 mr-1.5 text-xs">{r.category}</span>
                {TAX_CATEGORY_LABEL[r.category]}
              </td>
              <td className="figures py-2.5 text-right">{Number(r.rate)}%</td>
              <td className="py-2.5 text-right">
                {canEdit ? (
                  <span className="inline-flex gap-1">
                    {!r.isDefault ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => act(() => makeDefault(r.id))}
                      >
                        Make default
                      </Button>
                    ) : null}
                    <Button size="sm" variant="ghost" onClick={() => act(() => archive(r.id))}>
                      Archive
                    </Button>
                  </span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {canEdit ? (
        <form action={action} className="mt-8 grid items-end gap-4 sm:grid-cols-[2fr_2fr_1fr_auto]">
          <Field label="Name" error={fe.name}>
            {(f) => <Input id={f.id} name="name" placeholder="VAT 7% (reduced)" required />}
          </Field>
          <Field label="Category">
            {(f) => (
              <Select
                id={f.id}
                name="category"
                value={category}
                onChange={(e) => setCategory(e.target.value as TaxCategory)}
              >
                {TAX_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c} · {TAX_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Rate %" error={fe.rate}>
            {(f) => (
              <Input
                key={category}
                id={f.id}
                name="rate"
                defaultValue={category === "S" ? "" : "0"}
                readOnly={category !== "S"}
                inputMode="decimal"
                className="figures"
                required
              />
            )}
          </Field>
          <Button type="submit" variant="secondary" pending={adding}>
            Add rate
          </Button>
          <div className="sm:col-span-4">
            <FormFeedback state={state} success="Tax rate added." />
          </div>
        </form>
      ) : null}
    </div>
  );
}
