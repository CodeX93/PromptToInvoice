"use client";

import * as T from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export const TooltipProvider = T.Provider;

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <T.Root delayDuration={350}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          sideOffset={6}
          className="bg-ink text-paper z-50 max-w-64 rounded-xs px-2 py-1 text-xs leading-snug"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
