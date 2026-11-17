import type { Metadata } from "next";
import { PageHeader } from "@/components/shell/page-header";
import { requireOrg } from "@/server/session";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const ctx = await requireOrg();
  return (
    <>
      <PageHeader
        eyebrow={ctx.org.name}
        title={`Good to see you, ${ctx.user.name.split(" ")[0] ?? ""}.`}
      />
    </>
  );
}
