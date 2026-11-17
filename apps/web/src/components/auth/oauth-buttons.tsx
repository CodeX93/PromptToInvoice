"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { toast } from "@/components/ui/toast";

export type OAuthProvider = "google" | "microsoft";

const LABEL: Record<OAuthProvider, string> = { google: "Google", microsoft: "Microsoft" };

export function OAuthButtons({ providers, next }: { providers: OAuthProvider[]; next: string }) {
  const [pending, setPending] = useState<OAuthProvider | null>(null);
  if (providers.length === 0) return null;
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${providers.length}, minmax(0, 1fr))` }}
    >
      {providers.map((p) => (
        <Button
          key={p}
          type="button"
          variant="secondary"
          pending={pending === p}
          disabled={pending !== null}
          onClick={async () => {
            setPending(p);
            const { error } = await authClient.signIn.social({ provider: p, callbackURL: next });
            if (error) {
              toast.error(authErrorMessage(error));
              setPending(null);
            }
          }}
        >
          {LABEL[p]}
        </Button>
      ))}
    </div>
  );
}

export function Divider({ children }: { children: string }) {
  return (
    <div className="text-ink-4 text-2xs my-6 flex items-center gap-3 tracking-[0.1em] uppercase">
      <span className="bg-rule h-px flex-1" />
      {children}
      <span className="bg-rule h-px flex-1" />
    </div>
  );
}
