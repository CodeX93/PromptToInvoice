"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { cn } from "@/lib/cn";

/** Horizontal section tabs drawn as a ruled index, like tabs on a ledger. */
export function SubNav({ items }: { items: { href: Route; label: string }[] }) {
  const path = usePathname();
  return (
    <nav
      aria-label="Section"
      className="border-rule flex scrollbar-thin gap-6 overflow-x-auto border-b px-6 lg:px-10"
    >
      {items.map((it) => {
        const active = path === it.href;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px border-b py-2.5 text-[13px] whitespace-nowrap transition-colors",
              active ? "border-ink text-ink" : "text-ink-3 hover:text-ink border-transparent",
            )}
          >
            {it.label}
          </Link>
        );
      })}
    </nav>
  );
}
