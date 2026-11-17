import type { ReactNode } from "react";

/** Empty state: a blank ledger page with one clear next step. No illustrations. */
export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="border-rule-strong mx-6 my-10 border-y border-dashed px-6 py-16 text-center lg:mx-10">
      <p className="font-serif text-xl">{title}</p>
      {children ? <div className="text-ink-3 mx-auto mt-2 max-w-md text-sm leading-relaxed">{children}</div> : null}
      {action ? <div className="mt-6 flex justify-center">{action}</div> : null}
    </div>
  );
}
