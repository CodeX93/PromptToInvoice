"use client";

import { useActionState, useTransition } from "react";
import { ROLES, ROLE_LABEL, type Role } from "@pti/core";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { FormFeedback, fieldErrors } from "@/components/ui/form-feedback";
import { toast } from "@/components/ui/toast";
import { initialActionState } from "@/lib/action-state";
import { changeRole, inviteMember, removeMember, revokeInvitation } from "./actions";

export interface MemberRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  isSelf: boolean;
  since: string;
}
export interface InviteRow {
  id: string;
  email: string;
  role: Role;
  expires: string;
}

export function TeamView({
  members,
  invites,
  canManage,
  seats,
}: {
  members: MemberRow[];
  invites: InviteRow[];
  canManage: boolean;
  seats: string;
}) {
  const [pending, start] = useTransition();
  const [state, action, inviting] = useActionState(inviteMember, initialActionState);
  const fe = fieldErrors(state);
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(ok);
      else toast.error(r.error ?? "Failed");
    });

  return (
    <div aria-busy={pending}>
      <p className="text-ink-3 mb-4 text-xs">{seats}</p>
      <ul className="border-rule-strong border-t">
        {members.map((m) => (
          <li key={m.id} className="border-rule flex flex-wrap items-center gap-4 border-b py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">
                {m.name} {m.isSelf ? <span className="text-ink-3">(you)</span> : null}
              </p>
              <p className="text-ink-3 truncate text-xs">
                {m.email} · since {m.since}
              </p>
            </div>
            {canManage && !m.isSelf ? (
              <>
                <Select
                  aria-label={`Role for ${m.name}`}
                  defaultValue={m.role}
                  className="w-48"
                  onChange={(e) => act(() => changeRole(m.id, e.target.value), "Role updated.")}
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    confirm(`Remove ${m.name}?`) && act(() => removeMember(m.id), "Member removed.")
                  }
                >
                  Remove
                </Button>
              </>
            ) : (
              <span className="text-ink-2 text-xs">{ROLE_LABEL[m.role]}</span>
            )}
          </li>
        ))}
        {invites.map((i) => (
          <li key={i.id} className="border-rule flex items-center gap-4 border-b py-3">
            <div className="min-w-0 flex-1">
              <p className="text-ink-2 truncate text-sm">{i.email}</p>
              <p className="text-ink-3 text-xs">
                Invited as {ROLE_LABEL[i.role]} · expires {i.expires}
              </p>
            </div>
            {canManage ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => act(() => revokeInvitation(i.id), "Invitation revoked.")}
              >
                Revoke
              </Button>
            ) : null}
          </li>
        ))}
      </ul>

      {canManage ? (
        <form action={action} className="mt-8 grid items-end gap-4 sm:grid-cols-[2fr_1fr_auto]">
          <Field label="Invite by email" error={fe.email}>
            {(f) => (
              <Input
                id={f.id}
                name="email"
                type="email"
                required
                placeholder="colleague@company.com"
              />
            )}
          </Field>
          <Field label="Role">
            {(f) => (
              <Select id={f.id} name="role" defaultValue="member">
                {ROLES.filter((r) => r !== "owner").map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button type="submit" pending={inviting}>
            Send invite
          </Button>
          <div className="sm:col-span-3">
            <FormFeedback state={state} success="Invitation sent." />
          </div>
        </form>
      ) : null}
    </div>
  );
}
