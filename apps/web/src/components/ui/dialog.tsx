"use client";

import * as D from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  wide,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <D.Portal>
      <D.Overlay className="bg-ink/25 fixed inset-0 z-40 backdrop-grayscale data-[state=open]:animate-[fade-in_120ms_ease-out]" />
      <D.Content
        className={cn(
          "fixed top-[12vh] left-1/2 z-50 w-[calc(100vw-32px)] -translate-x-1/2",
          wide ? "max-w-2xl" : "max-w-md",
          "border-rule-strong bg-paper-raised shadow-pop rounded-sm border",
          "focus:outline-none",
          className,
        )}
      >
        <div className="border-rule border-b px-6 pt-5 pb-4">
          <D.Title className="font-serif text-xl">{title}</D.Title>
          {description ? (
            <D.Description className="text-ink-3 mt-1 text-sm">{description}</D.Description>
          ) : null}
        </div>
        <div className="px-6 py-5">{children}</div>
        <D.Close
          aria-label="Close"
          className="text-ink-3 hover:text-ink absolute top-4 right-4 grid size-7 place-items-center rounded-sm"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.4" />
          </svg>
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}
