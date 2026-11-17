"use client";

import { useActionState, useEffect, useState } from "react";
import { CURRENCY_CODES, isEuCountry, parseEuVatId, type Address } from "@pti/core";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormFeedback, fieldErrors } from "@/components/ui/form-feedback";
import type { ActionState } from "@/lib/action-state";
import { saveClient } from "@/app/app/clients/actions";

export interface ClientFormValues {
  id?: string;
  name: string;
  contactName: string | null;
  emails: string[];
  phone: string | null;
  address: Address | null;
  isBusiness: boolean;
  vatId: string | null;
  taxId: string | null;
  currency: string | null;
  paymentTermsDays: number | null;
  buyerReference: string | null;
  notes: string;
}

export const emptyClient: ClientFormValues = {
  name: "",
  contactName: null,
  emails: [],
  phone: null,
  address: null,
  isBusiness: true,
  vatId: null,
  taxId: null,
  currency: null,
  paymentTermsDays: null,
  buyerReference: null,
  notes: "",
};

const initial: ActionState<{ id: string }> = { ok: true, data: { id: "" } };

export function ClientForm({
  values,
  countries,
  onSaved,
  compact,
}: {
  values: ClientFormValues;
  countries: { code: string; name: string }[];
  onSaved?: (id: string) => void;
  /** Hide secondary fields (used inside the invoice editor's quick-add). */
  compact?: boolean;
}) {
  const [state, action, pending] = useActionState(saveClient, initial);
  const [country, setCountry] = useState(values.address?.country ?? "");
  const [vat, setVat] = useState(values.vatId ?? "");
  const [isBusiness, setIsBusiness] = useState(values.isBusiness);
  const fe = fieldErrors(state);

  useEffect(() => {
    if (state.ok && state.data.id) onSaved?.(state.data.id);
  }, [state, onSaved]);

  const vatHint =
    isEuCountry(country) && vat.length > 3
      ? parseEuVatId(vat)
        ? "Format looks right. Verify against VIES after saving."
        : "Doesn't look like an EU VAT number."
      : "Enables reverse charge for EU business clients.";

  return (
    <form action={action} className="grid gap-5 sm:grid-cols-6">
      {values.id ? <input type="hidden" name="id" value={values.id} /> : null}
      <Field label="Client name" className="sm:col-span-4" error={fe.name}>
        {(f) => (
          <Input
            id={f.id}
            name="name"
            defaultValue={values.name}
            required
            aria-invalid={f.invalid}
            autoFocus={!values.id}
          />
        )}
      </Field>
      <label className="text-ink-2 flex items-center gap-2 self-end pb-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          name="isBusiness"
          checked={isBusiness}
          onChange={(e) => setIsBusiness(e.target.checked)}
          className="accent-ink size-3.5"
        />
        Business client
      </label>
      <Field
        label="Billing email"
        hint="Separate several with commas."
        className="sm:col-span-4"
        error={fe.emails ?? fe["emails.0"]}
      >
        {(f) => (
          <Input
            id={f.id}
            name="emails"
            defaultValue={values.emails.join(", ")}
            inputMode="email"
          />
        )}
      </Field>
      <Field label="Contact person" optional className="sm:col-span-2">
        {(f) => <Input id={f.id} name="contactName" defaultValue={values.contactName ?? ""} />}
      </Field>

      <Field label="Country" className="sm:col-span-2">
        {(f) => (
          <Select
            id={f.id}
            name="country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          >
            <option value="">—</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Street" className="sm:col-span-4">
        {(f) => <Input id={f.id} name="line1" defaultValue={values.address?.line1 ?? ""} />}
      </Field>
      <Field label="Postcode" className="sm:col-span-2">
        {(f) => (
          <Input id={f.id} name="postalCode" defaultValue={values.address?.postalCode ?? ""} />
        )}
      </Field>
      <Field label="City" className="sm:col-span-2">
        {(f) => <Input id={f.id} name="city" defaultValue={values.address?.city ?? ""} />}
      </Field>
      <Field label="Region" optional className="sm:col-span-2">
        {(f) => <Input id={f.id} name="region" defaultValue={values.address?.region ?? ""} />}
      </Field>

      {isBusiness ? (
        <Field
          label={isEuCountry(country) ? "VAT number" : "Tax ID"}
          optional
          hint={vatHint}
          className="sm:col-span-3"
          error={fe.vatId}
        >
          {(f) => (
            <Input
              id={f.id}
              name="vatId"
              value={vat}
              onChange={(e) => setVat(e.target.value)}
              className="figures"
            />
          )}
        </Field>
      ) : null}

      {!compact ? (
        <>
          <Field label="Currency" optional className="sm:col-span-1">
            {(f) => (
              <Select id={f.id} name="currency" defaultValue={values.currency ?? ""}>
                <option value="">Default</option>
                {CURRENCY_CODES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Terms (days)"
            optional
            className="sm:col-span-2"
            error={fe.paymentTermsDays}
          >
            {(f) => (
              <Input
                id={f.id}
                name="paymentTermsDays"
                type="number"
                min={0}
                max={365}
                defaultValue={values.paymentTermsDays ?? ""}
                className="figures"
              />
            )}
          </Field>
          <Field
            label="Buyer reference"
            optional
            hint="PO number or Leitweg-ID (XRechnung)."
            className="sm:col-span-3"
          >
            {(f) => (
              <Input id={f.id} name="buyerReference" defaultValue={values.buyerReference ?? ""} />
            )}
          </Field>
          <Field label="Phone" optional className="sm:col-span-3">
            {(f) => <Input id={f.id} name="phone" type="tel" defaultValue={values.phone ?? ""} />}
          </Field>
          <Field label="Internal notes" optional className="sm:col-span-6">
            {(f) => <Textarea id={f.id} name="notes" defaultValue={values.notes} rows={2} />}
          </Field>
        </>
      ) : null}

      <div className="flex items-center gap-4 sm:col-span-6">
        <Button type="submit" pending={pending}>
          {values.id ? "Save client" : "Add client"}
        </Button>
        <div className="flex-1">
          <FormFeedback state={state} success={values.id ? "Client saved." : undefined} />
        </div>
      </div>
    </form>
  );
}
