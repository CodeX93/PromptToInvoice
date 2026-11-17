"use client";

import { useActionState, useState } from "react";
import { CURRENCY_CODES, isEuCountry, parseEuVatId, type CurrencyCode } from "@pti/core";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { defaultCurrencyFor } from "@/lib/locale-defaults";
import { initialActionState } from "@/lib/action-state";
import { completeOnboarding } from "./actions";

export function OnboardingForm({
  defaultName,
  defaultCountry,
  next,
  countries,
}: {
  defaultName: string;
  defaultCountry: string;
  next: string;
  /** Localised on the server so SSR and hydration agree (ICU data differs between Node and browsers). */
  countries: { code: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(completeOnboarding, initialActionState);
  const [country, setCountry] = useState(defaultCountry);
  const [currency, setCurrency] = useState<CurrencyCode>(defaultCurrencyFor(defaultCountry));
  const [vatId, setVatId] = useState("");
  const eu = isEuCountry(country);
  const fe = state.ok ? {} : (state.fieldErrors ?? {});
  const vatLooksWrong = eu && vatId.length > 4 && parseEuVatId(vatId) === null;

  return (
    <form action={action} className="flex flex-col gap-10">
      <input type="hidden" name="next" value={next} />
      {/* Filled from the browser after mount via a ref, so SSR and hydration agree. */}
      <input
        type="hidden"
        name="timeZone"
        defaultValue="UTC"
        ref={(el) => {
          if (el) el.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
        }}
      />

      <section className="grid gap-5">
        <h2 className="label-caps">Business</h2>
        <Field
          label="Business name"
          error={fe.businessName}
          hint="As it should appear on your invoices."
        >
          {(f) => (
            <Input
              id={f.id}
              name="businessName"
              defaultValue={defaultName}
              required
              aria-invalid={f.invalid}
              aria-describedby={f.describedBy}
              autoFocus
            />
          )}
        </Field>
        <Field
          label="Legal name"
          optional
          hint="If different, e.g. “Jane Doe Design GmbH”."
          error={fe.legalName}
        >
          {(f) => <Input id={f.id} name="legalName" aria-describedby={f.describedBy} />}
        </Field>
        <Field label="Billing email" optional hint="Replies from clients go here." error={fe.email}>
          {(f) => <Input id={f.id} name="email" type="email" aria-describedby={f.describedBy} />}
        </Field>
      </section>

      <section className="grid gap-5">
        <h2 className="label-caps">Address</h2>
        <Field label="Country" error={fe["address.country"]}>
          {(f) => (
            <Select
              id={f.id}
              name="country"
              value={country}
              onChange={(e) => {
                setCountry(e.target.value);
                setCurrency(defaultCurrencyFor(e.target.value));
              }}
            >
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Street" error={fe["address.line1"]}>
          {(f) => <Input id={f.id} name="line1" autoComplete="address-line1" />}
        </Field>
        <div className="grid grid-cols-[1fr_2fr] gap-5">
          <Field label="Postcode">
            {(f) => <Input id={f.id} name="postalCode" autoComplete="postal-code" />}
          </Field>
          <Field label="City">
            {(f) => <Input id={f.id} name="city" autoComplete="address-level2" />}
          </Field>
        </div>
        {country === "US" || country === "CA" || country === "AU" ? (
          <Field label={country === "US" ? "State" : "Province / state"}>
            {(f) => <Input id={f.id} name="region" autoComplete="address-level1" />}
          </Field>
        ) : null}
      </section>

      <section className="grid gap-5">
        <h2 className="label-caps">Tax &amp; currency</h2>
        <div className="grid grid-cols-2 gap-5">
          <Field label="Currency" hint="You can bill clients in others.">
            {(f) => (
              <Select
                id={f.id}
                name="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
              >
                {CURRENCY_CODES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label={eu ? "VAT number" : "Tax ID"}
            optional
            error={vatLooksWrong ? "That doesn't look like an EU VAT number." : fe.vatId}
          >
            {(f) => (
              <Input
                id={f.id}
                name="vatId"
                value={vatId}
                onChange={(e) => setVatId(e.target.value)}
                placeholder={eu ? `${country}…` : ""}
                className="figures"
                aria-invalid={f.invalid}
                aria-describedby={f.describedBy}
              />
            )}
          </Field>
        </div>
        {eu ? (
          <label className="text-ink-2 flex items-start gap-2.5 text-sm leading-snug">
            <input type="checkbox" name="vatExempt" className="accent-ink mt-0.5 size-3.5" />
            <span>
              I'm VAT-exempt as a small business
              <span className="text-ink-3 block text-xs">
                e.g. Kleinunternehmer (§19 UStG), franchise en base. Invoices will carry the
                exemption note.
              </span>
            </span>
          </label>
        ) : null}
      </section>

      {!state.ok && !state.fieldErrors ? (
        <p
          role="alert"
          className="border-danger bg-danger-soft text-danger border-l-2 px-3 py-2 text-sm"
        >
          {state.error}
        </p>
      ) : null}

      <Button type="submit" size="lg" pending={pending} className="self-start">
        Continue to your first invoice
      </Button>
    </form>
  );
}
