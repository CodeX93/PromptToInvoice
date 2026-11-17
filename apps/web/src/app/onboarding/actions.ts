"use server";

import { str } from "@/lib/form-data";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { auth } from "@/server/auth";
import { getSession } from "@/server/session";
import { parseOrThrow, run, type ActionResult } from "@/server/action";
import { createOrganization, onboardingSchema } from "@/server/services/onboarding";
import { UnauthorizedError } from "@/server/errors";
import { safeNext } from "@/lib/safe-redirect";

export async function completeOnboarding(
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const result = await run("onboarding.complete", async () => {
    const session = await getSession();
    if (!session) throw new UnauthorizedError();
    const input = parseOrThrow(onboardingSchema, {
      businessName: formData.get("businessName"),
      legalName: formData.get("legalName") || undefined,
      email: formData.get("email") ?? "",
      currency: formData.get("currency"),
      vatId: formData.get("vatId") || undefined,
      vatExempt: formData.get("vatExempt") === "on",
      timeZone: formData.get("timeZone") || "UTC",
      address: {
        line1: formData.get("line1") ?? "",
        line2: formData.get("line2") ?? "",
        city: formData.get("city") ?? "",
        region: formData.get("region") ?? "",
        postalCode: formData.get("postalCode") ?? "",
        country: formData.get("country"),
      },
    });
    const { orgId } = await createOrganization(session.user.id, input);
    await auth.api.setActiveOrganization({
      headers: await headers(),
      body: { organizationId: orgId },
    });
  });
  if (!result.ok) return result;
  redirect(safeNext(str(formData, "next"), "/app?welcome=1") as Route);
}
