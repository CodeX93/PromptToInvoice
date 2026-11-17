import "server-only";
import { z } from "zod";
import {
  addressSchema,
  bicSchema,
  checkQuota,
  currencySchema,
  ibanSchema,
  taxIdSchema,
  validateNumberPattern,
  DEFAULT_PATTERNS,
} from "@pti/core";
import {
  and,
  asc,
  eq,
  isNull,
  one,
  schema,
  sql,
  withOrg,
  type BankDetails,
  type Tx,
} from "@pti/db";
import { db } from "../db";
import { audit } from "../audit";
import { decryptJson, encryptJson } from "../crypto";
import { NotFound, QuotaExceededError, ValidationError } from "../errors";
import { authorize, type OrgContext } from "../session";
import { storeFile } from "../storage";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();

export const bankDetailsSchema = z
  .object({
    accountHolder: z.string().trim().max(120).optional(),
    iban: z.union([ibanSchema, z.literal("")]).optional(),
    bic: z.union([bicSchema, z.literal("")]).optional(),
    bankName: z.string().trim().max(120).optional(),
    routingNumber: z
      .string()
      .trim()
      .regex(/^\d{9}$/, "Routing numbers have 9 digits.")
      .or(z.literal(""))
      .optional(),
    accountNumber: z
      .string()
      .trim()
      .regex(/^\d{4,17}$/, "Use digits only.")
      .or(z.literal(""))
      .optional(),
  })
  .transform((b) => Object.fromEntries(Object.entries(b).filter(([, v]) => v)) as BankDetails);

export const profileSchema = z.object({
  legalName: z.string().trim().min(2).max(160),
  tradingName: optionalText(120),
  email: z
    .email()
    .or(z.literal(""))
    .transform((v) => v || null)
    .optional(),
  phone: optionalText(40),
  website: optionalText(200),
  address: addressSchema,
  vatId: taxIdSchema.transform((v) => v || null).optional(),
  taxId: optionalText(40),
  registrationNumber: optionalText(60),
  vatExempt: z.boolean(),
  vatExemptNote: optionalText(500),
  defaultCurrency: currencySchema,
  defaultPaymentTermsDays: z.coerce.number().int().min(0).max(365),
  defaultNotes: z.string().trim().max(4000),
  defaultTerms: z.string().trim().max(4000),
  locale: z.string().min(2).max(10),
  bank: bankDetailsSchema,
  accentColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  footer: z.string().trim().max(300).optional(),
});
export type ProfileInput = z.input<typeof profileSchema>;

/** Bank details are encrypted with the profile id as AAD, so a ciphertext can't be moved between rows. */
const bankAad = (profileId: string) => `business_profile:${profileId}:bank`;

export function readBank(row: {
  id: string;
  bankDetailsEncrypted: string | null;
}): BankDetails | null {
  return row.bankDetailsEncrypted
    ? decryptJson<BankDetails>(row.bankDetailsEncrypted, bankAad(row.id))
    : null;
}

export async function listProfiles(ctx: OrgContext) {
  return withOrg(db, ctx.org.id, (tx) =>
    tx
      .select()
      .from(schema.businessProfiles)
      .where(isNull(schema.businessProfiles.archivedAt))
      .orderBy(
        sql`${schema.businessProfiles.isDefault} desc`,
        asc(schema.businessProfiles.createdAt),
      ),
  );
}

export async function getProfile(ctx: OrgContext, id?: string) {
  return withOrg(db, ctx.org.id, async (tx) => {
    const [row] = await tx
      .select()
      .from(schema.businessProfiles)
      .where(id ? eq(schema.businessProfiles.id, id) : eq(schema.businessProfiles.isDefault, true))
      .limit(1);
    if (!row) throw new NotFound("Business profile");
    return { ...row, bank: readBank(row) };
  });
}

export async function updateProfile(
  ctx: OrgContext,
  id: string,
  input: z.infer<typeof profileSchema>,
) {
  authorize(ctx, "profile:write");
  await withOrg(db, ctx.org.id, async (tx) => {
    const current = one(
      await tx.select().from(schema.businessProfiles).where(eq(schema.businessProfiles.id, id)),
      "Business profile",
    );
    const { bank, accentColor, footer, ...fields } = input;
    await tx
      .update(schema.businessProfiles)
      .set({
        ...fields,
        bankDetailsEncrypted: Object.keys(bank).length ? encryptJson(bank, bankAad(id)) : null,
        branding: { ...current.branding, accentColor, footer },
      })
      .where(eq(schema.businessProfiles.id, id));
    await audit(tx, {
      orgId: ctx.org.id,
      actorId: ctx.user.id,
      action: "business_profile.updated",
      entityType: "business_profile",
      entityId: id,
      // Never write secrets to the audit log; record which fields changed.
      diff: {
        changed: Object.keys(fields).filter(
          (k) =>
            JSON.stringify(fields[k as keyof typeof fields]) !==
            JSON.stringify(current[k as keyof typeof current]),
        ),
        bankChanged: true,
      },
    });
  });
}

export async function createProfile(ctx: OrgContext, input: z.infer<typeof profileSchema>) {
  authorize(ctx, "profile:write");
  return withOrg(db, ctx.org.id, async (tx: Tx) => {
    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.businessProfiles)
      .where(isNull(schema.businessProfiles.archivedAt));
    const quota = checkQuota(ctx.org.plan, "businessProfiles", n);
    if (!quota.allowed) {
      throw new QuotaExceededError(
        `Your plan includes ${quota.limit ?? 0} business profile(s). Upgrade to add more.`,
        { feature: "businessProfiles" },
      );
    }
    const id = crypto.randomUUID();
    const { bank, accentColor, footer, ...fields } = input;
    await tx.insert(schema.businessProfiles).values({
      id,
      orgId: ctx.org.id,
      ...fields,
      bankDetailsEncrypted: Object.keys(bank).length ? encryptJson(bank, bankAad(id)) : null,
      branding: { accentColor, footer },
      isDefault: n === 0,
    });
    await tx.insert(schema.numberSeries).values(
      (["invoice", "credit_note", "quote"] as const).map((docType) => ({
        orgId: ctx.org.id,
        businessProfileId: id,
        docType,
        pattern: DEFAULT_PATTERNS[docType],
      })),
    );
    await audit(tx, {
      orgId: ctx.org.id,
      actorId: ctx.user.id,
      action: "business_profile.created",
      entityType: "business_profile",
      entityId: id,
    });
    return id;
  });
}

const LOGO_TYPES: Record<string, (b: Buffer) => boolean> = {
  "image/png": (b) =>
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) =>
    b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP",
};

/**
 * Logos are verified by magic bytes (not the client's MIME type), re-encoded
 * to a bounded PNG with metadata stripped, then stored. SVG is refused: it
 * can carry script and would end up inside PDFs and emails.
 */
export async function uploadLogo(ctx: OrgContext, profileId: string, file: File) {
  authorize(ctx, "profile:write");
  if (file.size > 2 * 1024 * 1024)
    throw new ValidationError("Logos must be under 2 MB.", { logo: ["Logos must be under 2 MB."] });
  const body = Buffer.from(await file.arrayBuffer());
  const kind = Object.entries(LOGO_TYPES).find(([, test]) => test(body))?.[0];
  if (!kind)
    throw new ValidationError("Use a PNG, JPEG or WebP image.", {
      logo: ["Use a PNG, JPEG or WebP image."],
    });
  const sharp = (await import("sharp")).default;
  const png = await sharp(body, { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 800, height: 400, fit: "inside", withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await withOrg(db, ctx.org.id, async (tx) => {
    one(
      await tx
        .select({ id: schema.businessProfiles.id })
        .from(schema.businessProfiles)
        .where(eq(schema.businessProfiles.id, profileId)),
      "Business profile",
    );
    const stored = await storeFile(tx, {
      orgId: ctx.org.id,
      kind: "logo",
      body: png,
      contentType: "image/png",
      fileName: "logo.png",
    });
    await tx
      .update(schema.businessProfiles)
      .set({ logoFileId: stored.id })
      .where(and(eq(schema.businessProfiles.id, profileId)));
    await audit(tx, {
      orgId: ctx.org.id,
      actorId: ctx.user.id,
      action: "business_profile.logo_updated",
      entityType: "business_profile",
      entityId: profileId,
    });
  });
}

export async function updateNumberPattern(
  ctx: OrgContext,
  seriesId: string,
  pattern: string,
  resetPolicy: "never" | "yearly" | "monthly",
) {
  authorize(ctx, "settings:write");
  const issue = validateNumberPattern(pattern);
  if (issue) throw new ValidationError(issue.message, { pattern: [issue.message] });
  await withOrg(db, ctx.org.id, async (tx) => {
    await tx
      .update(schema.numberSeries)
      .set({ pattern, resetPolicy })
      .where(eq(schema.numberSeries.id, seriesId));
    await audit(tx, {
      orgId: ctx.org.id,
      actorId: ctx.user.id,
      action: "number_series.updated",
      entityType: "number_series",
      entityId: seriesId,
      diff: { pattern, resetPolicy },
    });
  });
}
