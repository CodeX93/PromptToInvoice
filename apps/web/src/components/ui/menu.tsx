"use client";

import * as M from "@radix-ui/react-dropdown-menu";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;

export function MenuContent({
  children,
  align = "end",
  className,
}: {
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
}) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        className={cn(
          "border-rule-strong bg-paper-raised shadow-pop z-50 min-w-48 rounded-sm border p-1",
          className,
        )}
      >
        {children}
      </M.Content>
    </M.Portal>
  );
}

export function MenuItem({
  className,
  danger,
  ...props
}: ComponentProps<typeof M.Item> & { danger?: boolean }) {
  return (
    <M.Item
      className={cn(
        "flex cursor-default items-center gap-2 rounded-xs px-2.5 py-1.5 text-sm outline-none select-none",
        "data-[highlighted]:bg-paper-sunk data-[disabled]:opacity-40",
        danger ? "text-danger" : "text-ink",
        className,
      )}
      {...props}
    />
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <M.Label className="label-caps px-2.5 pt-2 pb-1">{children}</M.Label>;
}

export function MenuSeparator() {
  return <M.Separator className="bg-rule my-1 h-px" />;
}
