import type { ReactNode } from "react";
import { env } from "@/server/env";

/**
 * Long-form legal text, set like a contract: numbered clauses in the margin,
 * a readable measure, and the operator's identity from configuration so a
 * deployment never ships someone else's name.
 */
export function LegalDoc({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-[1180px] px-5 pt-14 sm:px-8">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        <header>
          <p className="label-caps">Legal</p>
          <h1 className="mt-2 font-serif text-4xl leading-tight">{title}</h1>
          <p className="text-ink-3 mt-3 text-sm">
            Last updated <span className="figures">{updated}</span>
          </p>
          <p className="text-ink-3 mt-6 text-sm leading-relaxed">
            {env.LEGAL_ENTITY}
            {env.LEGAL_ADDRESS ? (
              <>
                <br />
                {env.LEGAL_ADDRESS}
              </>
            ) : null}
            <br />
            <a className="underline underline-offset-4" href={`mailto:${env.LEGAL_EMAIL}`}>
              {env.LEGAL_EMAIL}
            </a>
          </p>
        </header>
        <article className="legal max-w-[42rem] text-[15px] leading-relaxed [counter-reset:clause]">
          {children}
        </article>
      </div>
    </main>
  );
}

export function Clause({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-rule before:text-ink-3 relative border-t py-6 pl-12 [counter-increment:clause] before:absolute before:top-6 before:left-0 before:font-mono before:text-sm before:content-[counter(clause,decimal-leading-zero)]">
      <h2 className="font-serif text-xl leading-snug">{title}</h2>
      <div className="text-ink-2 mt-3 space-y-3 [&_li]:ml-4 [&_li]:list-disc [&_ul]:space-y-1.5">
        {children}
      </div>
    </section>
  );
}
