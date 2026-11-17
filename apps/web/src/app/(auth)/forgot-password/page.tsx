"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { authClient } from "@/lib/auth-client";

export default function ForgotPasswordPage() {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    // Always report success: never reveal whether an account exists.
    await authClient.requestPasswordReset({
      email: String(new FormData(e.currentTarget).get("email") ?? "").trim(),
      redirectTo: "/reset-password",
    });
    setPending(false);
    setSent(true);
  }

  return (
    <div>
      <h1 className="text-3xl">Reset your password</h1>
      {sent ? (
        <p className="text-ink-2 mt-3 leading-relaxed">
          If an account exists for that email, a reset link is on its way. It expires in one hour.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5">
          <Field label="Email">{(f) => <Input id={f.id} name="email" type="email" autoComplete="email" required autoFocus />}</Field>
          <Button type="submit" size="lg" pending={pending}>
            Send reset link
          </Button>
        </form>
      )}
      <Link href="/sign-in" className="text-ink-3 hover:text-ink mt-8 inline-block text-sm">
        ← Back to sign in
      </Link>
    </div>
  );
}
