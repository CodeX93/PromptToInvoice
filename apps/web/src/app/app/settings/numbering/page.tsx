import type { Metadata } from "next";
import { resetPeriodKey, todayIn, type ResetPolicy } from "@pti/core";
import { and, eq, schema, withOrg } from "@pti/db";
import { Section } from "@/components/ui/section";
import { db } from "@/server/db";
import { requireOrg, can } from "@/server/session";
import { getProfile } from "@/server/services/business-profiles";
import { SeriesForm } from "./series-form";

export const metadata: Metadata = { title: "Numbering" };

export default async function NumberingPage() {
  const ctx = await requireOrg();
  const profile = await getProfile(ctx);
  const today = todayIn(ctx.org.timeZone);
  const series = await withOrg(db, ctx.org.id, async (tx) => {
    const rows = await tx.select().from(schema.numberSeries).where(eq(schema.numberSeries.businessProfileId, profile.id));
    return Promise.all(
      rows.map(async (r) => {
        const [c] = await tx
          .select({ last: schema.numberCounters.lastValue })
          .from(schema.numberCounters)
          .where(and(eq(schema.numberCounters.seriesId, r.id), eq(schema.numberCounters.periodKey, resetPeriodKey(r.resetPolicy as ResetPolicy, today))));
        return { id: r.id, docType: r.docType as "invoice" | "credit_note" | "quote", pattern: r.pattern, resetPolicy: r.resetPolicy, next: (c?.last ?? 0) + 1 };
      }),
    );
  });
  const order = { invoice: 0, credit_note: 1, quote: 2 };
  series.sort((a, b) => order[a.docType] - order[b.docType]);

  return (
    <Section
      title="Document numbers"
      description={
        <>
          Numbers are assigned when a document is issued, never skipped or reused. Tokens:{" "}
          <code className="figures">{"{YYYY}"}</code> <code className="figures">{"{YY}"}</code> <code className="figures">{"{MM}"}</code>{" "}
          <code className="figures">{"{SEQ:4}"}</code>.
        </>
      }
    >
      {series.map((s) => (
        <SeriesForm key={s.id} s={s} today={today} canEdit={can(ctx, "settings:write")} />
      ))}
    </Section>
  );
}
