import type { Metadata } from "next";
import type { TaxCategory } from "@pti/core";
import { Section } from "@/components/ui/section";
import { requireOrg, can } from "@/server/session";
import { listTaxRates } from "@/server/services/tax-rates";
import { TaxTable } from "./tax-table";

export const metadata: Metadata = { title: "Tax rates" };

export default async function TaxSettingsPage() {
  const ctx = await requireOrg();
  const rows = await listTaxRates(ctx);
  return (
    <Section
      title="Tax rates"
      description="Rates you can pick on invoice lines. The default is pre-selected; the invoice editor still suggests reverse charge or export treatment based on the client."
    >
      <TaxTable
        canEdit={can(ctx, "settings:write")}
        rows={rows.map((r) => ({
          id: r.id,
          name: r.name,
          category: r.category as TaxCategory,
          rate: r.rate,
          isDefault: r.isDefault,
          note: r.note,
        }))}
      />
    </Section>
  );
}
