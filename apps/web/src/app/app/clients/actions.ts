"use server";

import { revalidatePath } from "next/cache";
import { orgContextOrThrow } from "@/server/session";
import { parseOrThrow, run, type ActionResult } from "@/server/action";
import { clientSchema, createClient, setClientArchived, updateClient, verifyClientVat } from "@/server/services/clients";
import type { ViesResult } from "@/server/vies";
import { str } from "@/lib/form-data";

function parseClientForm(fd: FormData) {
  const country = str(fd, "country");
  return parseOrThrow(clientSchema, {
    name: str(fd, "name"),
    contactName: str(fd, "contactName"),
    emails: str(fd, "emails")
      .split(/[,;\s]+/)
      .map((e) => e.trim())
      .filter(Boolean),
    phone: str(fd, "phone"),
    address: country
      ? { line1: str(fd, "line1"), line2: str(fd, "line2"), city: str(fd, "city"), region: str(fd, "region"), postalCode: str(fd, "postalCode"), country }
      : null,
    isBusiness: fd.get("isBusiness") === "on",
    vatId: str(fd, "vatId"),
    taxId: str(fd, "taxId"),
    currency: str(fd, "currency") || null,
    paymentTermsDays: str(fd, "paymentTermsDays") || null,
    language: str(fd, "language"),
    buyerReference: str(fd, "buyerReference"),
    notes: str(fd, "notes"),
  });
}

export async function saveClient(_prev: ActionResult<{ id: string }>, fd: FormData): Promise<ActionResult<{ id: string }>> {
  return run("clients.save", async () => {
    const ctx = await orgContextOrThrow();
    const input = parseClientForm(fd);
    const id = str(fd, "id");
    if (id) await updateClient(ctx, id, input);
    const saved = id ? { id } : { id: (await createClient(ctx, input)).id };
    revalidatePath("/app/clients");
    return saved;
  });
}

export async function archiveClient(id: string, archived: boolean): Promise<ActionResult> {
  return run("clients.archive", async () => {
    await setClientArchived(await orgContextOrThrow(), id, archived);
    revalidatePath("/app/clients");
  });
}

export async function checkClientVat(id: string): Promise<ActionResult<ViesResult>> {
  return run("clients.vat", async () => {
    const r = await verifyClientVat(await orgContextOrThrow(), id);
    revalidatePath(`/app/clients/${id}`);
    return r;
  });
}

export interface ClientOption {
  id: string;
  name: string;
  email: string | null;
  country: string | null;
  vatId: string | null;
  isBusiness: boolean;
  vatIdValid: boolean;
  currency: string | null;
  paymentTermsDays: number | null;
}

/** Typeahead for the invoice editor: fuzzy match when there's a query, recent clients otherwise. */
export async function searchClientsAction(q: string): Promise<ClientOption[]> {
  const ctx = await orgContextOrThrow();
  const { getClientOptions } = await import("@/server/services/client-options");
  return getClientOptions(ctx, q.slice(0, 100));
}
