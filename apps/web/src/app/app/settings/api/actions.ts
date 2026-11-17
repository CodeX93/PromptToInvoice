"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { WEBHOOK_EVENTS } from "@pti/db";
import { str } from "@/lib/form-data";
import { orgContextOrThrow } from "@/server/session";
import { parseOrThrow, run, type ActionResult } from "@/server/action";
import { enforce, RULES } from "@/server/rate-limit";
import { createApiKey, revokeApiKey } from "@/server/services/api-keys";
import { createEndpoint, deleteEndpoint, sendTestEvent } from "@/server/services/webhooks";

const PATH = "/app/settings/api";
const uuid = z.uuid();

export async function createKeyAction(
  _prev: ActionResult<{ key: string } | undefined>,
  fd: FormData,
): Promise<ActionResult<{ key: string } | undefined>> {
  return run("api.key_create", async () => {
    const ctx = await orgContextOrThrow();
    await enforce(`apikey:${ctx.org.id}`, RULES.sensitive);
    const { key } = await createApiKey(ctx, str(fd, "name"));
    revalidatePath(PATH);
    return { key };
  });
}

export async function revokeKeyAction(id: string): Promise<ActionResult> {
  return run("api.key_revoke", async () => {
    await revokeApiKey(await orgContextOrThrow(), uuid.parse(id));
    revalidatePath(PATH);
  });
}

const endpointForm = z.object({
  url: z.string().trim().min(1, "Enter the URL that should receive events."),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, "Pick at least one event."),
});

export async function createEndpointAction(
  _prev: ActionResult<{ secret: string } | undefined>,
  fd: FormData,
): Promise<ActionResult<{ secret: string } | undefined>> {
  return run("api.webhook_create", async () => {
    const ctx = await orgContextOrThrow();
    await enforce(`webhook:${ctx.org.id}`, RULES.sensitive);
    const input = parseOrThrow(endpointForm, { url: fd.get("url"), events: fd.getAll("events") });
    const { secret } = await createEndpoint(ctx, input);
    revalidatePath(PATH);
    return { secret };
  });
}

export async function deleteEndpointAction(id: string): Promise<ActionResult> {
  return run("api.webhook_delete", async () => {
    await deleteEndpoint(await orgContextOrThrow(), uuid.parse(id));
    revalidatePath(PATH);
  });
}

export async function testEndpointAction(id: string): Promise<ActionResult> {
  return run("api.webhook_test", async () => {
    const ctx = await orgContextOrThrow();
    await enforce(`webhook-test:${ctx.org.id}`, RULES.sensitive);
    await sendTestEvent(ctx, uuid.parse(id));
    revalidatePath(PATH);
  });
}
