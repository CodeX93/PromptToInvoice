"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { orgContextOrThrow } from "@/server/session";
import { run, type ActionResult } from "@/server/action";
import { setScheduleStatus } from "@/server/services/recurring";

export async function setStatus(id: string, status: "active" | "paused" | "ended"): Promise<ActionResult> {
  return run("recurring.status", async () => {
    await setScheduleStatus(await orgContextOrThrow(), z.uuid().parse(id), z.enum(["active", "paused", "ended"]).parse(status));
    revalidatePath("/app/invoices/recurring");
  });
}
