import type { ReactNode } from "react";
import { PageHeader } from "@/components/shell/page-header";
import { SubNav } from "@/components/shell/sub-nav";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PageHeader title="Settings" />
      <SubNav
        items={[
          { href: "/app/settings", label: "Business" },
          { href: "/app/settings/tax", label: "Tax rates" },
          { href: "/app/settings/numbering", label: "Numbering" },
          { href: "/app/settings/payments", label: "Payments" },
          { href: "/app/settings/ai", label: "AI" },
          { href: "/app/settings/team", label: "Team" },
          { href: "/app/settings/api", label: "API & webhooks" },
          { href: "/app/settings/billing", label: "Plan & billing" },
          { href: "/app/settings/account", label: "Account & security" },
          { href: "/app/settings/data", label: "Data & privacy" },
        ]}
      />
      <div className="px-6 py-8 lg:px-10">{children}</div>
    </>
  );
}
