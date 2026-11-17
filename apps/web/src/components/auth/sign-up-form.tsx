"use client";

import { str } from "@/lib/form-data";
import Link from "next/link";
import { useState, type SubmitEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { Divider, OAuthButtons, type OAuthProvider } from "./oauth-buttons";
import { PasswordMeter } from "./password-meter";

export function SignUpForm({ next, providers }: { next: string; providers: OAuthProvider[] }) {
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = str(fd, "email").trim();
    setPending(true);
    setError(null);
    const { error: err } = await authClient.signUp.email({
      name: str(fd, "name").trim(),
      email,
      password,
      callbackURL: `/onboarding?next=${encodeURIComponent(next)}`,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      locale: navigator.language.slice(0, 2),
    } as Parameters<typeof authClient.signUp.email>[0]);
    setPending(false);
    if (err) setError(authErrorMessage(err));
    else setSentTo(email);
  }

  if (sentTo) {
    return (
      <div>
        <h1 className="text-3xl">Confirm your email</h1>
        <p className="text-ink-2 mt-3 leading-relaxed">
          We sent a link to <span className="text-ink font-medium">{sentTo}</span>. Open it to
          finish setting up. You can close this tab.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl">Start invoicing</h1>
      <p className="text-ink-3 mt-2">
        Free for your first 5 invoices a month. Already have an account?{" "}
        <Link href="/sign-in" className="text-ink underline underline-offset-4">
          Sign in
        </Link>
      </p>
      <div className="mt-8">
        <OAuthButtons providers={providers} next="/onboarding" />
        {providers.length > 0 ? <Divider>or with email</Divider> : null}
      </div>
      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <Field label="Your name">
          {(f) => (
            <Input id={f.id} name="name" autoComplete="name" required maxLength={100} autoFocus />
          )}
        </Field>
        <Field label="Work email">
          {(f) => <Input id={f.id} name="email" type="email" autoComplete="email" required />}
        </Field>
        <Field label="Password">
          {(f) => (
            <div className="flex flex-col gap-2">
              <Input
                id={f.id}
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <PasswordMeter value={password} />
            </div>
          )}
        </Field>
        {error ? (
          <p
            role="alert"
            className="border-danger bg-danger-soft text-danger border-l-2 px-3 py-2 text-sm"
          >
            {error}
          </p>
        ) : null}
        <Button type="submit" size="lg" pending={pending} disabled={password.length < 10}>
          Create account
        </Button>
        <p className="text-ink-3 text-xs leading-relaxed">
          By creating an account you agree to the{" "}
          <Link href="/legal/terms" className="underline">
            Terms
          </Link>{" "}
          and{" "}
          <Link href="/legal/privacy" className="underline">
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    </div>
  );
}
