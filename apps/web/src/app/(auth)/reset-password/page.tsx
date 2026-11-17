"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type SubmitEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { PasswordMeter } from "@/components/auth/password-meter";
import { authClient, authErrorMessage } from "@/lib/auth-client";

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(
    params.get("error") ? "This link has expired or was already used." : null,
  );

  async function onSubmit(e: SubmitEvent) {
    e.preventDefault();
    if (!token) return;
    setPending(true);
    const { error: err } = await authClient.resetPassword({ newPassword: password, token });
    setPending(false);
    if (err) setError(authErrorMessage(err));
    else router.replace("/sign-in?reset=1");
  }

  if (!token || error) {
    return (
      <div>
        <h1 className="text-3xl">Link expired</h1>
        <p className="text-ink-2 mt-3">{error ?? "This reset link is incomplete."}</p>
        <Link
          href="/forgot-password"
          className="text-ink mt-6 inline-block underline underline-offset-4"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-3xl">Choose a new password</h1>
      <p className="text-ink-3 mt-2">You'll be signed out on other devices.</p>
      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5">
        <Field label="New password">
          {(f) => (
            <div className="flex flex-col gap-2">
              <Input
                id={f.id}
                type="password"
                autoComplete="new-password"
                minLength={10}
                maxLength={128}
                required
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <PasswordMeter value={password} />
            </div>
          )}
        </Field>
        <Button type="submit" size="lg" pending={pending} disabled={password.length < 10}>
          Save password
        </Button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetForm />
    </Suspense>
  );
}
