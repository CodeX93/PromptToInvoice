import type { Metadata } from "next";
import { Section } from "@/components/ui/section";
import { requireOrg, can } from "@/server/session";
import { DeleteOrgForm, ExportButton } from "./data-forms";

export const metadata: Metadata = { title: "Data & privacy" };

export default async function DataSettingsPage() {
  const ctx = await requireOrg();
  return (
    <>
      <Section
        title="Export"
        description="Everything: clients, invoices, lines, payments, history and every archived PDF, as JSON + PDF in a zip. The download link is emailed to you and works for 7 days."
      >
        {can(ctx, "export:run") ? (
          <ExportButton />
        ) : (
          <p className="text-ink-3 text-sm">Ask an owner or admin to export data.</p>
        )}
      </Section>
      {can(ctx, "org:delete") ? (
        <Section
          title="Delete organisation"
          description="Removes your team, clients, drafts, settings and subscription immediately. Issued invoices, credit notes, payments and their PDFs are kept, locked, until the legal retention period ends (up to 10 years), then deleted automatically."
        >
          <DeleteOrgForm orgName={ctx.org.name} />
        </Section>
      ) : null}
    </>
  );
}
