"use server";

import { revalidatePath } from "next/cache";
import { orgContextOrThrow } from "@/server/session";
import { run, type ActionResult } from "@/server/action";
import { updateOrgSettings } from "@/server/services/org-settings";

export async function saveAiSettings(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return run("settings.ai", async () => {
    const ctx = await orgContextOrThrow();
    await updateOrgSettings(ctx, { ai: { enabled: fd.get("enabled") === "on", retainPrompts: fd.get("retainPrompts") === "on" } });
    revalidatePath("/app", "layout");
  });
}
