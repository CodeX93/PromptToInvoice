"use server";

import { revalidatePath } from "next/cache";
import { orgContextOrThrow } from "@/server/session";
import { parseOrThrow, run, type ActionResult } from "@/server/action";
import {
  archiveTaxRate,
  createTaxRate,
  setDefaultTaxRate,
  taxRateSchema,
} from "@/server/services/tax-rates";

export async function addTaxRate(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("tax.add", async () => {
    const ctx = await orgContextOrThrow();
    await createTaxRate(ctx, parseOrThrow(taxRateSchema, Object.fromEntries(fd)));
    revalidatePath("/app/settings/tax");
  });
}

export async function makeDefault(id: string): Promise<ActionResult> {
  return run("tax.default", async () => {
    await setDefaultTaxRate(await orgContextOrThrow(), id);
    revalidatePath("/app/settings/tax");
  });
}

export async function archive(id: string): Promise<ActionResult> {
  return run("tax.archive", async () => {
    await archiveTaxRate(await orgContextOrThrow(), id);
    revalidatePath("/app/settings/tax");
  });
}
