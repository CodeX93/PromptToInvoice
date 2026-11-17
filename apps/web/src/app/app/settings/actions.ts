"use server";

import { revalidatePath } from "next/cache";
import { orgContextOrThrow } from "@/server/session";
import { parseOrThrow, run, type ActionResult } from "@/server/action";
import { profileSchema, updateProfile, uploadLogo, updateNumberPattern } from "@/server/services/business-profiles";
import { ValidationError } from "@/server/errors";

const s = (fd: FormData, k: string) => (fd.get(k) as string | null) ?? "";

export async function saveProfile(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("settings.profile.save", async () => {
    const ctx = await orgContextOrThrow();
    const input = parseOrThrow(profileSchema, {
      legalName: s(fd, "legalName"),
      tradingName: s(fd, "tradingName"),
      email: s(fd, "email"),
      phone: s(fd, "phone"),
      website: s(fd, "website"),
      address: { line1: s(fd, "line1"), line2: s(fd, "line2"), city: s(fd, "city"), region: s(fd, "region"), postalCode: s(fd, "postalCode"), country: s(fd, "country") },
      vatId: s(fd, "vatId"),
      taxId: s(fd, "taxId"),
      registrationNumber: s(fd, "registrationNumber"),
      vatExempt: fd.get("vatExempt") === "on",
      vatExemptNote: s(fd, "vatExemptNote"),
      defaultCurrency: s(fd, "defaultCurrency"),
      defaultPaymentTermsDays: s(fd, "defaultPaymentTermsDays"),
      defaultNotes: s(fd, "defaultNotes"),
      defaultTerms: s(fd, "defaultTerms"),
      locale: s(fd, "locale") || "en",
      bank: {
        accountHolder: s(fd, "bank.accountHolder"),
        iban: s(fd, "bank.iban"),
        bic: s(fd, "bank.bic"),
        bankName: s(fd, "bank.bankName"),
        routingNumber: s(fd, "bank.routingNumber"),
        accountNumber: s(fd, "bank.accountNumber"),
      },
      accentColor: s(fd, "accentColor") || undefined,
      footer: s(fd, "footer"),
    });
    await updateProfile(ctx, s(fd, "id"), input);
    revalidatePath("/app/settings");
  });
}

export async function saveLogo(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("settings.profile.logo", async () => {
    const ctx = await orgContextOrThrow();
    const file = fd.get("logo");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError("Choose an image.", { logo: ["Choose an image."] });
    await uploadLogo(ctx, s(fd, "id"), file);
    revalidatePath("/app/settings");
  });
}

export async function saveNumbering(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("settings.numbering.save", async () => {
    const ctx = await orgContextOrThrow();
    const policy = s(fd, "resetPolicy");
    await updateNumberPattern(ctx, s(fd, "seriesId"), s(fd, "pattern").trim(), policy === "never" || policy === "monthly" ? policy : "yearly");
    revalidatePath("/app/settings/numbering");
  });
}
