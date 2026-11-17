import type { ReactNode } from "react";

/** Two-column settings section: explanation in the margin, controls on the right. */
export function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-rule grid gap-6 border-b py-8 first:pt-0 last:border-b-0 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)] md:gap-12">
      <div>
        <h2 className="font-serif text-lg">{title}</h2>
        {description ? <p className="text-ink-3 mt-1 text-[13px] leading-relaxed">{description}</p> : null}
      </div>
      <div className="max-w-2xl">{children}</div>
    </section>
  );
}
