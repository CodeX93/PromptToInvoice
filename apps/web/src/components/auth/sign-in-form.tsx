"use client";

import { str } from "@/lib/form-data";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type SubmitEvent } from "react";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { authClient, authErrorMessage } from "@/lib/auth-client";
import { Divider, OAuthButtons, type OAuthProvider } from "./oauth-buttons";

type Mode = "password" | "link";

export function SignInForm({
  next,
  providers,
  notice,
}: {
  next: string;
  providers: OAuthProvider[];
  /** Server-provided message, e.g. why a magic link didn't sign you in. */
  notice?: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("password");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(notice ?? null);
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const email = str(fd, "email").trim();
    setPending(true);
    setError(null);
    if (mode === "link") {
      const { error: err } = await authClient.signIn.magicLink({ email, callbackURL: next });
      setPending(false);
      if (err) setError(authErrorMessage(err));
      else setLinkSentTo(email);
      return;
    }
    const { error: err } = await authClient.signIn.email({
      email,
      password: str(fd, "password"),
      rememberMe: fd.get("remember") === "on",
      callbackURL: next,
    });
    if (err) {
      setPending(false);
      setError(authErrorMessage(err));
      return;
    }
    router.replace(next as Route);
    router.refresh();
  }

  if (linkSentTo) {
    return (
      <div>
        <h1 className="text-3xl">Check your inbox</h1>
        <p className="text-ink-2 mt-3 leading-relaxed">
          We sent a sign-in link to <span className="text-ink font-medium">{linkSentTo}</span>. It
          works once and expires in 10 minutes.
        </p>
        <Button variant="link" className="mt-6" onClick={() => setLinkSentTo(null)}>
          Use a different email
        </Button>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl">Sign in</h1>
      <p className="text-ink-3 mt-2">
        New here?{" "}
        <Link
          href={`/sign-up${next !== "/app" ? `?next=${encodeURIComponent(next)}` : ""}` as Route}
          className="text-ink underline underline-offset-4"
        >
          Create an account
        </Link>
      </p>

      <div className="mt-8">
        <OAuthButtons providers={providers} next={next} />
        {providers.length > 0 ? <Divider>or with email</Divider> : null}
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-5" noValidate>
        <Field label="Email">
          {(f) => (
            <Input id={f.id} name="email" type="email" autoComplete="email" required autoFocus />
          )}
        </Field>
        {mode === "password" ? (
          <Field
            label={
              <span className="flex w-full justify-between">
                Password
                <Link
                  href="/forgot-password"
                  className="text-ink-3 hover:text-ink tracking-normal normal-case"
                >
                  Forgot?
                </Link>
              </span>
            }
          >
            {(f) => (
              <Input
                id={f.id}
                name="password"
                type="password"
                autoComplete="current-password"
                required
              />
            )}
          </Field>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="border-danger bg-danger-soft text-danger border-l-2 px-3 py-2 text-sm"
          >
            {error}
          </p>
        ) : null}

        {mode === "password" ? (
          <label className="text-ink-2 flex items-center gap-2 text-sm">
            <input type="checkbox" name="remember" defaultChecked className="accent-ink size-3.5" />
            Keep me signed in on this device
          </label>
        ) : null}

        <Button type="submit" size="lg" pending={pending}>
          {mode === "password" ? "Sign in" : "Email me a sign-in link"}
        </Button>
        <button
          type="button"
          onClick={() => {
            setMode(mode === "password" ? "link" : "password");
            setError(null);
          }}
          className="text-ink-3 hover:text-ink text-sm"
        >
          {mode === "password" ? "Sign in with an email link instead" : "Use my password instead"}
        </button>
      </form>
    </div>
  );
}
