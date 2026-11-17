"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { Route } from "next";
import { orgContextOrThrow } from "@/server/session";
import { run, type ActionResult } from "@/server/action";
import { connectDashboardLink, connectOnboardingLink } from "@/server/services/stripe";
import { updateOrgSettings } from "@/server/services/org-settings";
import { str } from "@/lib/form-data";

export async function startStripeOnboarding(fd: FormData): Promise<void> {
  const ctx = await orgContextOrThrow();
  redirect((await connectOnboardingLink(ctx, str(fd, "profileId"))) as Route);
}

export async function openStripeDashboard(fd: FormData): Promise<void> {
  const ctx = await orgContextOrThrow();
  redirect((await connectDashboardLink(ctx, str(fd, "profileId"))) as Route);
}

export async function saveReminders(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("settings.reminders", async () => {
    const ctx = await orgContextOrThrow();
    const offsets = fd
      .getAll("offset")
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n))
      .sort((a, b) => a - b);
    await updateOrgSettings(ctx, { reminders: { enabled: fd.get("enabled") === "on", offsets: [...new Set(offsets)] } });
    revalidatePath("/app/settings/payments");
  });
}
