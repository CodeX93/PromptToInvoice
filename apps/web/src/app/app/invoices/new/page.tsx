import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { InvoiceEditor } from "@/components/invoices/invoice-editor";
import { requireOrg, can } from "@/server/session";
import { editorProps } from "@/server/services/editor-props";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage(props: PageProps<"/app/invoices/new">) {
  const ctx = await requireOrg();
  if (!can(ctx, "invoice:write")) redirect("/app/invoices");
  const sp = await props.searchParams;
  const clientId = typeof sp.client === "string" && /^[0-9a-f-]{36}$/.test(sp.client) ? sp.client : null;
  return <InvoiceEditor {...await editorProps(ctx, null, { clientId })} />;
}
