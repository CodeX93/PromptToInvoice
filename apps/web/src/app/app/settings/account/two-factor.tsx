"use client";

import { str } from "@/lib/form-data";
import { useRouter } from "next/navigation";
import { useState, type SubmitEvent } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { authClient, authErrorMessage } from "@/lib/auth-client";

type Step =
  | { kind: "idle" }
  | { kind: "scan"; svg: string; secret: string; backupCodes: string[] }
  | { kind: "codes"; backupCodes: string[] };

/** Enrol TOTP: confirm password → scan QR → verify a code → save backup codes. */
export function TwoFactor({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [pending, setPending] = useState(false);

  async function start(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = str(new FormData(e.currentTarget), "password");
    setPending(true);
    const { data, error } = await authClient.twoFactor.enable({ password });
    setPending(false);
    if (error) {
      toast.error(authErrorMessage(error));
      return;
    }
    if (data.method !== "totp") {
      toast.error("Authenticator setup is unavailable.");
      return;
    }
    const svg = await QRCode.toString(data.totpURI, {
      type: "svg",
      margin: 0,
      color: { dark: "#16140f", light: "#00000000" },
    });
    setStep({
      kind: "scan",
      svg,
      secret: new URL(data.totpURI).searchParams.get("secret") ?? "",
      backupCodes: data.backupCodes,
    });
  }

  async function verify(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step.kind !== "scan") return;
    setPending(true);
    const { error } = await authClient.twoFactor.verifyTotp({
      code: str(new FormData(e.currentTarget), "code").replace(/\s/g, ""),
    });
    setPending(false);
    if (error) {
      toast.error(authErrorMessage(error));
      return;
    }
    setStep({ kind: "codes", backupCodes: step.backupCodes });
  }

  async function disable(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setPending(true);
    const { error } = await authClient.twoFactor.disable({
      password: str(new FormData(e.currentTarget), "password"),
    });
    setPending(false);
    if (error) {
      toast.error(authErrorMessage(error));
      return;
    }
    toast.success("Two-step verification turned off.");
    router.refresh();
  }

  if (step.kind === "scan") {
    return (
      <form onSubmit={verify} className="grid gap-6 sm:grid-cols-[160px_1fr]">
        <div
          className="bg-paper-raised border-rule-strong rounded-xs border p-3 dark:bg-white"
          dangerouslySetInnerHTML={{ __html: step.svg }}
        />
        <div className="flex flex-col gap-4">
          <p className="text-ink-2 text-sm">
            Scan with an authenticator app (1Password, Authy, Google Authenticator), then enter the
            6-digit code.
          </p>
          <p className="text-ink-3 text-xs">
            Can't scan? Key: <code className="figures text-ink break-all">{step.secret}</code>
          </p>
          <Field label="Code">
            {(f) => (
              <Input
                id={f.id}
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                className="figures w-40 tracking-[0.3em]"
              />
            )}
          </Field>
          <Button type="submit" pending={pending} className="self-start">
            Verify and turn on
          </Button>
        </div>
      </form>
    );
  }

  if (step.kind === "codes") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-positive text-sm">Two-step verification is on.</p>
        <p className="text-ink-2 text-sm">
          Save these backup codes somewhere safe. Each works once if you lose your phone.
        </p>
        <ul className="figures bg-paper-sunk grid grid-cols-2 gap-x-8 gap-y-1 rounded-xs p-4 text-sm sm:grid-cols-5">
          {step.backupCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              void navigator.clipboard
                .writeText(step.backupCodes.join("\n"))
                .then(() => toast.success("Copied."))
            }
          >
            Copy codes
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setStep({ kind: "idle" });
              router.refresh();
            }}
          >
            I've saved them
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={enabled ? disable : start} className="flex flex-wrap items-end gap-4">
      <p className="w-full text-sm">
        Status:{" "}
        {enabled ? (
          <span className="text-positive">On</span>
        ) : (
          <span className="text-ink-3">Off</span>
        )}
      </p>
      <Field label="Confirm your password" className="w-64">
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
      <Button type="submit" variant={enabled ? "danger" : "primary"} pending={pending}>
        {enabled ? "Turn off" : "Set up authenticator"}
      </Button>
    </form>
  );
}
