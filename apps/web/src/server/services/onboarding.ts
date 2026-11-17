import "server-only";
import { z } from "zod";
import {
  DEFAULT_EXEMPTION_NOTES,
  DEFAULT_PATTERNS,
  addressSchema,
  currencySchema,
  euCountry,
  isValidTimeZone,
  taxIdSchema,
} from "@pti/core";
import { one, schema, type Tx } from "@pti/db";
import { sysDb } from "../db";
import { audit } from "../audit";
import { randomToken } from "../crypto";

export const onboardingSchema = z.object({
  businessName: z.string().trim().min(2, "Enter your business name.").max(120),
  legalName: z.string().trim().max(160).optional(),
  address: addressSchema,
  currency: currencySchema,
  vatId: taxIdSchema.optional(),
  vatExempt: z.boolean().default(false),
  timeZone: z.string().refine(isValidTimeZone, "Unknown time zone.").default("UTC"),
  email: z.email().optional().or(z.literal("")),
});
export type OnboardingInput = z.infer<typeof onboardingSchema>;

function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "org"}-${randomToken(3)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "x")}`;
}

/** Default tax rates for the seller's country, so the first invoice needs no setup. */
function defaultTaxRates(orgId: string, country: string, vatExempt: boolean) {
  const eu = euCountry(country);
  if (!eu) {
    return [
      { orgId, name: "No tax", category: "O", rate: "0", country, isDefault: true, note: null },
    ];
  }
  if (vatExempt) {
    return [
      {
        orgId,
        name: "VAT exempt",
        category: "E",
        rate: "0",
        country,
        isDefault: true,
        note: DEFAULT_EXEMPTION_NOTES.E ?? null,
      },
    ];
  }
  return [
    {
      orgId,
      name: `VAT ${eu.standardVatRate}%`,
      category: "S",
      rate: eu.standardVatRate,
      country,
      isDefault: true,
      note: null,
    },
    {
      orgId,
      name: "Reverse charge (EU B2B)",
      category: "AE",
      rate: "0",
      country: null,
      isDefault: false,
      note: DEFAULT_EXEMPTION_NOTES.AE ?? null,
    },
    {
      orgId,
      name: "Outside scope (non-EU)",
      category: "O",
      rate: "0",
      country: null,
      isDefault: false,
      note: DEFAULT_EXEMPTION_NOTES.O ?? null,
    },
    { orgId, name: "Zero rated", category: "Z", rate: "0", country, isDefault: false, note: null },
  ];
}

export async function createOrganization(
  userId: string,
  input: OnboardingInput,
): Promise<{ orgId: string }> {
  return sysDb.transaction(async (tx: Tx) => {
    const org = one(
      await tx
        .insert(schema.organizations)
        .values({
          name: input.businessName,
          slug: slugify(input.businessName),
          timeZone: input.timeZone,
          region: euCountry(input.address.country) ? "eu" : "us",
        })
        .returning({ id: schema.organizations.id }),
    );
    await tx.insert(schema.members).values({ organizationId: org.id, userId, role: "owner" });

    const profile = one(
      await tx
        .insert(schema.businessProfiles)
        .values({
          orgId: org.id,
          legalName: input.legalName || input.businessName,
          tradingName:
            input.legalName && input.legalName !== input.businessName ? input.businessName : null,
          address: input.address,
          vatId: input.vatId || null,
          vatExempt: input.vatExempt,
          vatExemptNote: input.vatExempt ? (DEFAULT_EXEMPTION_NOTES.E ?? null) : null,
          defaultCurrency: input.currency,
          email: input.email || null,
          locale: "en",
          isDefault: true,
        })
        .returning({ id: schema.businessProfiles.id }),
    );

    await tx.insert(schema.numberSeries).values([
      {
        orgId: org.id,
        businessProfileId: profile.id,
        docType: "invoice",
        pattern: DEFAULT_PATTERNS.invoice,
      },
      {
        orgId: org.id,
        businessProfileId: profile.id,
        docType: "credit_note",
        pattern: DEFAULT_PATTERNS.credit_note,
      },
      {
        orgId: org.id,
        businessProfileId: profile.id,
        docType: "quote",
        pattern: DEFAULT_PATTERNS.quote,
      },
    ]);
    await tx
      .insert(schema.taxRates)
      .values(defaultTaxRates(org.id, input.address.country, input.vatExempt));

    await audit(tx, {
      orgId: org.id,
      actorId: userId,
      action: "org.created",
      entityType: "organization",
      entityId: org.id,
    });
    return { orgId: org.id };
  });
}
