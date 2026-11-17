import type { ReactNode } from "react";
import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";
import { getSession } from "@/server/session";

export default async function MarketingLayout({ children }: { children: ReactNode }) {
  const signedIn = Boolean(await getSession());
  return (
    <div className="bg-paper text-ink min-h-dvh">
      <header className="border-rule mx-auto flex h-16 max-w-[1180px] items-center gap-6 border-b px-5 sm:px-8">
        <Link href="/" aria-label="PromptToInvoice home">
          <Wordmark className="text-[19px]" />
        </Link>
        <nav
          aria-label="Site"
          className="text-ink-2 ml-auto hidden items-center gap-6 text-sm sm:flex"
        >
          <Link href="/#how" className="hover:text-ink">
            How it works
          </Link>
          <Link href="/#pricing" className="hover:text-ink">
            Pricing
          </Link>
          <a href="/api/v1/openapi.json" className="hover:text-ink">
            API
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          {signedIn ? (
            <Button asChild size="sm">
              <Link href="/app">Open the app</Link>
            </Button>
          ) : (
            <>
              <Link href="/sign-in" className="text-ink-2 hover:text-ink px-2 text-sm">
                Sign in
              </Link>
              <Button asChild size="sm">
                <Link href="/sign-up">Start free</Link>
              </Button>
            </>
          )}
        </div>
      </header>
      {children}
      <footer className="border-rule-strong mx-auto mt-24 max-w-[1180px] border-t px-5 py-10 sm:px-8">
        <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3 text-[13px]">
          <Wordmark className="text-[15px]" />
          <Link href="/legal/terms" className="text-ink-2 hover:text-ink">
            Terms
          </Link>
          <Link href="/legal/privacy" className="text-ink-2 hover:text-ink">
            Privacy
          </Link>
          <a href="/api/v1/openapi.json" className="text-ink-2 hover:text-ink">
            OpenAPI
          </a>
          <p className="text-ink-3 figures ml-auto text-xs">EU data stays in the EU.</p>
        </div>
      </footer>
    </div>
  );
}
