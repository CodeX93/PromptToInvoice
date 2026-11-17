"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { cn } from "@/lib/cn";

export interface NavItem {
  href: Route;
  label: string;
  /** Keyboard shortcut shown on hover, e.g. "G I". */
  keys?: string;
  count?: number;
}

export function Nav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col">
      {items.map((it) => {
        const active = it.href === "/app" ? path === "/app" : path.startsWith(it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex items-center justify-between py-1.5 pr-2 pl-4 text-[13px] transition-colors",
              active ? "text-ink font-medium" : "text-ink-3 hover:text-ink",
            )}
          >
            {/* Active item is marked like a ruled margin, not a filled pill. */}
            <span
              className={cn(
                "absolute top-1.5 bottom-1.5 left-0 w-[2px]",
                active ? "bg-ink" : "bg-transparent",
              )}
            />
            <span>{it.label}</span>
            {it.count ? (
              <span className="figures text-ink-3 text-2xs">{it.count}</span>
            ) : it.keys ? (
              <kbd className="figures text-ink-4 text-2xs hidden group-hover:inline">{it.keys}</kbd>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
