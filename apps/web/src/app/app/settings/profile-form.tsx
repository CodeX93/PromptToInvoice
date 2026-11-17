"use client";

import { useActionState, useState } from "react";
import { CURRENCY_CODES, isEuCountry, type Address } from "@pti/core";
import type { BankDetails } from "@pti/db/schema";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { FormFeedback, fieldErrors } from "@/components/ui/form-feedback";
import { Section } from "@/components/ui/section";
import { initialActionState } from "@/lib/action-state";
import { saveLogo, saveProfile } from "./actions";

export interface ProfileView {
  id: string;
  legalName: string;
  tradingName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: Address;
  vatId: string | null;
  taxId: string | null;
  registrationNumber: string | null;
  vatExempt: boolean;
  vatExemptNote: string | null;
  defaultCurrency: string;
  defaultPaymentTermsDays: number;
  defaultNotes: string;
  defaultTerms: string;
  locale: string;
  bank: BankDetails | null;
  accentColor: string;
  footer: string;
  logoUrl: string | null;
}

export function ProfileForm({ p, countries, canEdit }: { p: ProfileView; countries: { code: string; name: string }[]; canEdit: boolean }) {
  const [state, action, pending] = useActionState(saveProfile, initialActionState);
  const [country, setCountry] = useState(p.address.country);
  const fe = fieldErrors(state);
  const eu = isEuCountry(country);
  const err = (k: string) => fe[k];

  return (
    <>
      <LogoSection id={p.id} logoUrl={p.logoUrl} canEdit={canEdit} />
      <form action={action}>
        <input type="hidden" name="id" value={p.id} />
        <input type="hidden" name="locale" value={p.locale} />
        <fieldset disabled={!canEdit} className="contents">
          <Section title="Identity" description="Printed in the header of every invoice.">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Legal name" error={err("legalName")}>{(f) => <Input id={f.id} name="legalName" defaultValue={p.legalName} required aria-invalid={f.invalid} />}</Field>
              <Field label="Trading name" optional>{(f) => <Input id={f.id} name="tradingName" defaultValue={p.tradingName ?? ""} />}</Field>
              <Field label="Email" optional error={err("email")}>{(f) => <Input id={f.id} name="email" type="email" defaultValue={p.email ?? ""} />}</Field>
              <Field label="Phone" optional>{(f) => <Input id={f.id} name="phone" type="tel" defaultValue={p.phone ?? ""} />}</Field>
              <Field label="Website" optional className="sm:col-span-2">{(f) => <Input id={f.id} name="website" defaultValue={p.website ?? ""} placeholder="https://" />}</Field>
            </div>
          </Section>

          <Section title="Address">
            <div className="grid gap-5 sm:grid-cols-6">
              <Field label="Street" className="sm:col-span-6" error={err("address.line1")}>{(f) => <Input id={f.id} name="line1" defaultValue={p.address.line1} />}</Field>
              <Field label="Address line 2" optional className="sm:col-span-6">{(f) => <Input id={f.id} name="line2" defaultValue={p.address.line2} />}</Field>
              <Field label="Postcode" className="sm:col-span-2">{(f) => <Input id={f.id} name="postalCode" defaultValue={p.address.postalCode} />}</Field>
              <Field label="City" className="sm:col-span-4">{(f) => <Input id={f.id} name="city" defaultValue={p.address.city} />}</Field>
              <Field label="Region / state" optional className="sm:col-span-3">{(f) => <Input id={f.id} name="region" defaultValue={p.address.region} />}</Field>
              <Field label="Country" className="sm:col-span-3">
                {(f) => (
                  <Select id={f.id} name="country" value={country} onChange={(e) => setCountry(e.target.value)}>
                    {countries.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </Section>

          <Section title="Tax" description={eu ? "EU sellers: your VAT number appears on every invoice and enables reverse charge for EU business clients." : "Shown on invoices if set."}>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label={eu ? "VAT number" : "Tax ID"} optional error={err("vatId")}>{(f) => <Input id={f.id} name="vatId" defaultValue={p.vatId ?? ""} className="figures" />}</Field>
              <Field label="Tax number" optional hint="National tax number, if different.">{(f) => <Input id={f.id} name="taxId" defaultValue={p.taxId ?? ""} className="figures" />}</Field>
              <Field label="Company registration" optional className="sm:col-span-2" hint="e.g. HRB 123456, Amtsgericht Berlin">{(f) => <Input id={f.id} name="registrationNumber" defaultValue={p.registrationNumber ?? ""} />}</Field>
            </div>
            {eu ? (
              <div className="mt-6 grid gap-3">
                <label className="text-ink-2 flex items-center gap-2 text-sm">
                  <input type="checkbox" name="vatExempt" defaultChecked={p.vatExempt} className="accent-ink size-3.5" />
                  Small-business VAT exemption
                </label>
                <Field label="Exemption note" optional hint="Printed on invoices when the exemption applies.">
                  {(f) => <Input id={f.id} name="vatExemptNote" defaultValue={p.vatExemptNote ?? ""} placeholder="Gemäß § 19 UStG wird keine Umsatzsteuer berechnet." />}
                </Field>
              </div>
            ) : null}
          </Section>

          <Section title="Getting paid" description="Encrypted at rest. Shown on invoices so clients can pay by transfer; EU invoices also get a scan-to-pay QR code.">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Account holder" optional>{(f) => <Input id={f.id} name="bank.accountHolder" defaultValue={p.bank?.accountHolder ?? ""} />}</Field>
              <Field label="Bank name" optional>{(f) => <Input id={f.id} name="bank.bankName" defaultValue={p.bank?.bankName ?? ""} />}</Field>
              <Field label="IBAN" optional error={err("bank.iban")}>{(f) => <Input id={f.id} name="bank.iban" defaultValue={p.bank?.iban ?? ""} className="figures" autoComplete="off" />}</Field>
              <Field label="BIC / SWIFT" optional error={err("bank.bic")}>{(f) => <Input id={f.id} name="bank.bic" defaultValue={p.bank?.bic ?? ""} className="figures" autoComplete="off" />}</Field>
              {country === "US" ? (
                <>
                  <Field label="Routing number (ACH)" optional error={err("bank.routingNumber")}>{(f) => <Input id={f.id} name="bank.routingNumber" defaultValue={p.bank?.routingNumber ?? ""} className="figures" inputMode="numeric" />}</Field>
                  <Field label="Account number" optional error={err("bank.accountNumber")}>{(f) => <Input id={f.id} name="bank.accountNumber" defaultValue={p.bank?.accountNumber ?? ""} className="figures" inputMode="numeric" autoComplete="off" />}</Field>
                </>
              ) : null}
            </div>
          </Section>

          <Section title="Invoice defaults" description="Used for new invoices; each invoice can override them.">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Currency">
                {(f) => (
                  <Select id={f.id} name="defaultCurrency" defaultValue={p.defaultCurrency}>
                    {CURRENCY_CODES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Payment terms (days)" error={err("defaultPaymentTermsDays")}>{(f) => <Input id={f.id} name="defaultPaymentTermsDays" type="number" min={0} max={365} defaultValue={p.defaultPaymentTermsDays} className="figures" />}</Field>
              <Field label="Notes" optional className="sm:col-span-2" hint="e.g. a thank-you line.">{(f) => <Textarea id={f.id} name="defaultNotes" defaultValue={p.defaultNotes} rows={2} />}</Field>
              <Field label="Terms" optional className="sm:col-span-2" hint="Late fees, payment instructions.">{(f) => <Textarea id={f.id} name="defaultTerms" defaultValue={p.defaultTerms} rows={2} />}</Field>
              <Field label="Footer" optional className="sm:col-span-2">{(f) => <Input id={f.id} name="footer" defaultValue={p.footer} maxLength={300} />}</Field>
              <Field label="Accent colour" hint="Used for rules and headings on your invoices.">
                {(f) => <input id={f.id} name="accentColor" type="color" defaultValue={p.accentColor} className="border-rule-strong h-9 w-16 cursor-pointer rounded-xs border bg-transparent p-1" />}
              </Field>
            </div>
          </Section>

          <div className="bg-paper/95 sticky bottom-0 flex items-center gap-4 border-t border-rule py-4 backdrop-blur-[2px]">
            <Button type="submit" pending={pending}>
              Save changes
            </Button>
            <div className="flex-1">
              <FormFeedback state={state} success="Business details saved." />
            </div>
          </div>
        </fieldset>
      </form>
    </>
  );
}

function LogoSection({ id, logoUrl, canEdit }: { id: string; logoUrl: string | null; canEdit: boolean }) {
  const [state, action, pending] = useActionState(saveLogo, initialActionState);
  return (
    <Section title="Logo" description="PNG, JPEG or WebP, up to 2 MB. We resize it for print and email.">
      <form action={action} className="flex items-center gap-6">
        <input type="hidden" name="id" value={id} />
        <div className="border-rule-strong bg-paper-raised grid h-20 w-40 place-items-center overflow-hidden rounded-xs border border-dashed">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- private, authenticated asset
            <img src={logoUrl} alt="Current logo" className="max-h-16 max-w-36 object-contain" />
          ) : (
            <span className="text-ink-4 text-xs">No logo</span>
          )}
        </div>
        {canEdit ? (
          <div className="flex flex-col gap-2">
            <input name="logo" type="file" accept="image/png,image/jpeg,image/webp" className="text-ink-2 text-xs file:mr-3 file:rounded-xs file:border file:border-rule-strong file:bg-paper-raised file:px-2.5 file:py-1 file:text-xs" />
            <Button type="submit" variant="secondary" size="sm" pending={pending} className="self-start">
              Upload
            </Button>
            <FormFeedback state={state} success="Logo updated." />
          </div>
        ) : null}
      </form>
    </Section>
  );
}
