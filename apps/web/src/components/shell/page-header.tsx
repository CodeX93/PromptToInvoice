import type { ReactNode } from "react";

/** Page title set like a document heading, with actions on the right margin. */
export function PageHeader({ title, eyebrow, children, description }: { title: ReactNode; eyebrow?: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 px-6 pt-8 pb-6 lg:px-10">
      <div className="min-w-0">
        {eyebrow ? <p className="label-caps mb-1.5">{eyebrow}</p> : null}
        <h1 className="text-[28px] leading-tight">{title}</h1>
        {description ? <p className="text-ink-3 mt-1.5 max-w-2xl text-sm">{description}</p> : null}
      </div>
      {children ? <div className="flex items-center gap-2">{children}</div> : null}
    </header>
  );
}
