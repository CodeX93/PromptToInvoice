"use server";

import { revalidatePath } from "next/cache";
import { orgContextOrThrow } from "@/server/session";
import { run, type ActionResult } from "@/server/action";
import { createAiDraft } from "@/server/services/ai-drafts";

/** Prompt → invoice draft. POST-only (server action), so prefetching can never spend AI quota. */
export async function draftFromPrompt(
  prompt: string,
): Promise<ActionResult<{ invoiceId: string }>> {
  return run("ai.draft", async () => {
    const ctx = await orgContextOrThrow();
    const { invoiceId } = await createAiDraft(ctx, typeof prompt === "string" ? prompt : "");
    revalidatePath("/app/invoices");
    return { invoiceId };
  });
}
