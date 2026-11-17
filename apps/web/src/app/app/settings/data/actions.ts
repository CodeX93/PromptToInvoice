"use server";

import { redirect } from "next/navigation";
import { orgContextOrThrow } from "@/server/session";
import { run, type ActionResult } from "@/server/action";
import { requestExport } from "@/server/services/data-export";
import { deleteOrganization } from "@/server/services/org-deletion";
import { str } from "@/lib/form-data";

export async function exportData(): Promise<ActionResult> {
  return run("data.export", async () => {
    await requestExport(await orgContextOrThrow());
  });
}

export async function deleteOrg(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const r = await run("data.delete-org", async () => {
    await deleteOrganization(await orgContextOrThrow(), str(fd, "confirm"));
  });
  if (!r.ok) return r;
  redirect("/onboarding");
}
