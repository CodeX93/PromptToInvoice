import type { ReactNode } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { Nav, type NavItem } from "@/components/shell/nav";
import { PromptBar } from "@/components/shell/prompt-bar";
import { UserMenu } from "@/components/shell/user-menu";
import { requireOrg, can } from "@/server/session";
import { features } from "@/server/env";
import { PLANS } from "@pti/core";
import { getOrgSettings } from "@/server/services/org-settings";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const ctx = await requireOrg();
  const settings = await getOrgSettings(ctx.org.id);
  const items: NavItem[] = [
    { href: "/app", label: "Overview", keys: "G D" },
    { href: "/app/invoices", label: "Invoices", keys: "G I" },
    { href: "/app/clients", label: "Clients", keys: "G C" },
  ];
  if (can(ctx, "report:read")) items.push({ href: "/app/reports", label: "Reports" });
  items.push({ href: "/app/settings", label: "Settings", keys: "G S" });

  return (
    <div className="grid min-h-dvh grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="border-rule bg-paper hidden flex-col border-r md:sticky md:top-0 md:flex md:h-dvh">
        <div className="flex h-12 items-center px-4">
          <Link href="/app" className="text-[15px]">
            <Wordmark />
          </Link>
        </div>
        <div className="mt-4 flex-1">
          <Link
            href="/app/invoices/new"
            className="bg-ink text-paper hover:bg-ink-2 mx-4 mb-6 flex h-8 items-center justify-between rounded-sm px-3 text-[13px] font-medium"
          >
            New invoice
            <kbd className="figures text-paper/60 text-2xs">C</kbd>
          </Link>
          <Nav items={items} />
        </div>
        <div className="border-rule border-t p-2">
          <Link
            href="/app/settings/billing"
            className="text-ink-4 hover:text-ink-2 text-2xs block px-2 pb-2"
          >
            {PLANS[ctx.org.plan].name} plan{ctx.org.plan === "starter" ? " · Upgrade" : ""}
          </Link>
          <UserMenu name={ctx.user.name} email={ctx.user.email} orgName={ctx.org.name} />
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <div className="bg-paper/95 sticky top-0 z-30 backdrop-blur-[2px]">
          <MobileBar />
          <PromptBar aiEnabled={features.ai && settings.ai.enabled} />
        </div>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

function MobileBar() {
  return (
    <div className="border-rule flex h-12 items-center justify-between border-b px-4 md:hidden">
      <Link href="/app">
        <Wordmark />
      </Link>
      <nav className="flex gap-4 text-[13px]">
        <Link href="/app/invoices">Invoices</Link>
        <Link href="/app/clients">Clients</Link>
        <Link href="/app/settings">Settings</Link>
      </nav>
    </div>
  );
}
