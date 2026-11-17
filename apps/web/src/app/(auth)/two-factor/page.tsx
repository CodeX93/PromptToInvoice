"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { authClient, authErrorMessage } from "@/lib/auth-client";

export default function TwoFactorPage() {
  const router = useRouter();
  const [backup, setBackup] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const code = String(fd.get("code") ?? "").replace(/\s/g, "");
    const trustDevice = fd.get("trust") === "on";
    setPending(true);
    setError(null);
    const { error: err } = backup
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice });
    setPending(false);
    if (err) setError(authErrorMessage(err));
    else {
      router.replace("/app");
      router.refresh();
    }
  }

  return (
    <div>
      <h1 className="text-3xl">Two-step verification</h1>
      <p className="text-ink-3 mt-2">
        {backup ? "Enter one of your backup codes." : "Enter the 6-digit code from your authenticator app."}
      </p>
      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5">
        <Field label={backup ? "Backup code" : "Code"} error={error ?? undefined}>
          {(f) => (
            <Input
              id={f.id}
              name="code"
              required
              autoFocus
              autoComplete="one-time-code"
              inputMode={backup ? "text" : "numeric"}
              pattern={backup ? undefined : "[0-9 ]{6,7}"}
              aria-invalid={f.invalid}
              aria-describedby={f.describedBy}
              className="figures text-lg tracking-[0.3em]"
            />
          )}
        </Field>
        <label className="text-ink-2 flex items-center gap-2 text-sm">
          <input type="checkbox" name="trust" className="accent-ink size-3.5" />
          Trust this device for 30 days
        </label>
        <Button type="submit" size="lg" pending={pending}>
          Verify
        </Button>
        <button type="button" className="text-ink-3 hover:text-ink text-sm" onClick={() => setBackup(!backup)}>
          {backup ? "Use authenticator code" : "Use a backup code"}
        </button>
      </form>
    </div>
  );
}
