import type { Metadata } from "next";
import { COUNTRY_CODES, countryName } from "@pti/core";
import { requireOrg, can } from "@/server/session";
import { getProfile } from "@/server/services/business-profiles";
import { ProfileForm } from "./profile-form";

export const metadata: Metadata = { title: "Business settings" };

export default async function BusinessSettingsPage() {
  const ctx = await requireOrg();
  const p = await getProfile(ctx);
  const countries = COUNTRY_CODES.map((c) => ({ code: c, name: countryName(c) })).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <ProfileForm
      canEdit={can(ctx, "profile:write")}
      countries={countries}
      p={{
        id: p.id,
        legalName: p.legalName,
        tradingName: p.tradingName,
        email: p.email,
        phone: p.phone,
        website: p.website,
        address: p.address,
        vatId: p.vatId,
        taxId: p.taxId,
        registrationNumber: p.registrationNumber,
        vatExempt: p.vatExempt,
        vatExemptNote: p.vatExemptNote,
        defaultCurrency: p.defaultCurrency,
        defaultPaymentTermsDays: p.defaultPaymentTermsDays,
        defaultNotes: p.defaultNotes,
        defaultTerms: p.defaultTerms,
        locale: p.locale,
        bank: p.bank,
        accentColor: p.branding.accentColor ?? "#16140f",
        footer: p.branding.footer ?? "",
        logoUrl: p.logoFileId ? `/api/files/${p.logoFileId}` : null,
      }}
    />
  );
}
