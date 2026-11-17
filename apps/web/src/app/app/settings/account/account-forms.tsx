"use client";

import { str } from "@/lib/form-data";
import { useRouter } from "next/navigation";
import { useState, useTransition, type SubmitEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { PasswordMeter } from "@/components/auth/password-meter";
import { authClient, authErrorMessage } from "@/lib/auth-client";

export function ProfileBasics({
  name,
  timeZone,
  zones,
}: {
  name: string;
  timeZone: string;
  zones: string[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setPending(true);
    const { error } = await authClient.updateUser({
      name: str(fd, "name"),
      timeZone: str(fd, "timeZone"),
    } as Parameters<typeof authClient.updateUser>[0]);
    setPending(false);
    if (error) toast.error(authErrorMessage(error));
    else {
      toast.success("Profile saved.");
      router.refresh();
    }
  }
  return (
    <form onSubmit={onSubmit} className="grid items-end gap-5 sm:grid-cols-[1fr_1fr_auto]">
      <Field label="Name">
        {(f) => <Input id={f.id} name="name" defaultValue={name} required maxLength={100} />}
      </Field>
      <Field label="Time zone">
        {(f) => (
          <Select id={f.id} name="timeZone" defaultValue={timeZone}>
            {zones.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </Select>
        )}
      </Field>
      <Button type="submit" variant="secondary" pending={pending}>
        Save
      </Button>
    </form>
  );
}

export function ChangePassword() {
  const [pw, setPw] = useState("");
  const [pending, setPending] = useState(false);
  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setPending(true);
    const { error } = await authClient.changePassword({
      currentPassword: str(new FormData(form), "current"),
      newPassword: pw,
      revokeOtherSessions: true,
    });
    setPending(false);
    if (error) {
      toast.error(authErrorMessage(error));
      return;
    }
    toast.success("Password changed. Other devices were signed out.");
    form.reset();
    setPw("");
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-5 sm:grid-cols-2">
      <Field label="Current password">
        {(f) => (
          <Input
            id={f.id}
            name="current"
            type="password"
            autoComplete="current-password"
            required
          />
        )}
      </Field>
      <Field label="New password">
        {(f) => (
          <div className="flex flex-col gap-2">
            <Input
              id={f.id}
              type="password"
              autoComplete="new-password"
              minLength={10}
              required
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
            <PasswordMeter value={pw} />
          </div>
        )}
      </Field>
      <Button
        type="submit"
        variant="secondary"
        pending={pending}
        disabled={pw.length < 10}
        className="justify-self-start"
      >
        Change password
      </Button>
    </form>
  );
}

export interface SessionRow {
  id: string;
  token: string;
  device: string;
  ip: string | null;
  lastSeen: string;
  current: boolean;
}

export function Sessions({ sessions }: { sessions: SessionRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <ul className="border-rule-strong border-t" aria-busy={pending}>
      {sessions.map((s) => (
        <li key={s.id} className="border-rule flex items-center gap-4 border-b py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm">
              {s.device}{" "}
              {s.current ? <span className="text-positive text-xs">· this device</span> : null}
            </p>
            <p className="text-ink-3 figures text-xs">
              {s.ip ?? "unknown IP"} · {s.lastSeen}
            </p>
          </div>
          {!s.current ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                start(async () => {
                  const { error } = await authClient.revokeSession({ token: s.token });
                  if (error) toast.error(authErrorMessage(error));
                  else router.refresh();
                })
              }
            >
              Sign out
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
