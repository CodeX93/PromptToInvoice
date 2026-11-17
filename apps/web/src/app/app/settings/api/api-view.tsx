"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormFeedback, fieldErrors } from "@/components/ui/form-feedback";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/cn";
import {
  createEndpointAction,
  createKeyAction,
  deleteEndpointAction,
  revokeKeyAction,
  testEndpointAction,
} from "./actions";

type Result = { ok: true } | { ok: false; error: string };

function useAct() {
  const [pending, start] = useTransition();
  const act = (fn: () => Promise<Result>, done: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(done);
      else toast.error(r.error);
    });
  return [pending, act] as const;
}

/**
 * A secret shown exactly once, styled as a tear-off slip: the perforated
 * edge says "take this with you", which is the whole message.
 */
function SecretSlip({ label, value, note }: { label: string; value: string; note: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div
      role="status"
      className="bg-paper-raised border-ink relative mt-5 border-t border-dashed px-4 pt-4 pb-3"
    >
      <p className="label-caps">{label}</p>
      <div className="mt-2 flex items-start gap-3">
        <code className="figures text-ink min-w-0 flex-1 text-[13px] break-all select-all">
          {value}
        </code>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="text-ink-3 mt-2 text-xs">{note}</p>
    </div>
  );
}

export interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  created: string;
  lastUsed: string | null;
}

export function ApiKeysView({ keys }: { keys: KeyRow[] }) {
  const [state, action, creating] = useActionState(createKeyAction, {
    ok: true,
    data: undefined,
  });
  const [pending, act] = useAct();
  const fe = fieldErrors(state);
  const fresh = state.ok ? state.data?.key : undefined;

  return (
    <div aria-busy={pending}>
      {keys.length ? (
        <ul className="border-rule-strong border-t">
          {keys.map((k) => (
            <li key={k.id} className="border-rule flex items-center gap-4 border-b py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{k.name}</p>
                <p className="text-ink-3 text-xs">
                  <span className="figures">pti_live_{k.prefix}_…</span> · created {k.created} ·{" "}
                  {k.lastUsed ? `last used ${k.lastUsed}` : "never used"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  confirm(`Revoke “${k.name}”? Anything using it stops working immediately.`) &&
                  act(() => revokeKeyAction(k.id), "Key revoked.")
                }
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-3 text-sm">No keys yet.</p>
      )}

      <form action={action} className="mt-6 flex items-end gap-3">
        <Field label="New key" error={fe.name} className="flex-1">
          {(f) => (
            <Input
              id={f.id}
              name="name"
              required
              maxLength={60}
              placeholder="What uses it, e.g. “Shop backend”"
            />
          )}
        </Field>
        <Button type="submit" pending={creating}>
          Create key
        </Button>
      </form>
      {state.ok ? null : <FormFeedback state={state} />}
      {fresh ? (
        <SecretSlip
          label="Your new key"
          value={fresh}
          note="This is the only time it's shown. Store it in your secrets manager; we keep only a hash."
        />
      ) : null}
    </div>
  );
}

export interface EndpointRow {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  failures: number;
}
export interface DeliveryRow {
  id: string;
  url: string;
  type: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  code: number | null;
  error: string | null;
  at: string;
}

export function WebhooksView({
  events,
  endpoints,
  deliveries,
}: {
  events: string[];
  endpoints: EndpointRow[];
  deliveries: DeliveryRow[];
}) {
  const [state, action, creating] = useActionState(createEndpointAction, {
    ok: true,
    data: undefined,
  });
  const [pending, act] = useAct();
  const fe = fieldErrors(state);
  const secret = state.ok ? state.data?.secret : undefined;

  return (
    <div aria-busy={pending}>
      {endpoints.length ? (
        <ul className="border-rule-strong border-t">
          {endpoints.map((e) => (
            <li key={e.id} className="border-rule border-b py-3">
              <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <p className="figures truncate text-[13px]">{e.url}</p>
                  <p className="text-ink-3 mt-0.5 text-xs">
                    {e.events.join(", ")}
                    {e.active ? null : (
                      <span className="text-danger">
                        {" "}
                        · paused after {e.failures} failed deliveries
                      </span>
                    )}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    act(
                      () => testEndpointAction(e.id),
                      e.active ? "Test event queued." : "Endpoint resumed; test event queued.",
                    )
                  }
                >
                  {e.active ? "Send test" : "Resume"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    confirm("Delete this endpoint and its delivery history?") &&
                    act(() => deleteEndpointAction(e.id), "Endpoint deleted.")
                  }
                >
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-3 text-sm">No endpoints yet.</p>
      )}

      <form action={action} className="mt-6 grid gap-4">
        <Field label="Endpoint URL" error={fe.url} hint="Public https only.">
          {(f) => (
            <Input
              id={f.id}
              name="url"
              type="url"
              required
              inputMode="url"
              placeholder="https://example.com/webhooks/prompttoinvoice"
            />
          )}
        </Field>
        <fieldset>
          <legend className="text-ink-2 mb-2 text-[13px]">Events</legend>
          <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {events.map((ev) => (
              <label key={ev} className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  name="events"
                  value={ev}
                  defaultChecked={ev === "invoice.paid"}
                  className="accent-ink size-3.5"
                />
                <span className="figures">{ev}</span>
              </label>
            ))}
          </div>
          {fe.events ? <p className="text-danger mt-1 text-xs">{fe.events}</p> : null}
        </fieldset>
        <div>
          <Button type="submit" pending={creating}>
            Add endpoint
          </Button>
        </div>
      </form>
      {state.ok ? null : <FormFeedback state={state} />}
      {secret ? (
        <SecretSlip
          label="Signing secret"
          value={secret}
          note="Shown once. Verify the PTI-Signature header: HMAC-SHA256 of “t.body” with this secret, and reject timestamps older than five minutes."
        />
      ) : null}

      {deliveries.length ? (
        <div className="mt-10">
          <h3 className="label-caps mb-2">Recent deliveries</h3>
          <table className="w-full text-[13px]">
            <thead className="sr-only">
              <tr>
                <th>When</th>
                <th>Event</th>
                <th>Endpoint</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id} className="border-rule border-b align-baseline">
                  <td className="figures text-ink-3 w-28 py-1.5 pr-3 text-xs whitespace-nowrap">
                    {d.at}
                  </td>
                  <td className="figures py-1.5 pr-3">{d.type}</td>
                  <td className="text-ink-3 hidden w-1/2 max-w-0 truncate py-1.5 pr-3 text-xs sm:table-cell">
                    {d.url.replace(/^https:\/\//, "")}
                  </td>
                  <td
                    className={cn(
                      "figures py-1.5 text-right text-xs whitespace-nowrap",
                      d.status === "delivered" && "text-positive",
                      d.status === "failed" && "text-danger",
                      d.status === "pending" && "text-ink-2",
                    )}
                    title={d.error ?? undefined}
                  >
                    {d.status === "delivered"
                      ? (d.code ?? "ok")
                      : d.status === "failed"
                        ? `failed${d.code ? ` · ${d.code}` : ""}`
                        : d.attempts
                          ? `retrying · ${d.attempts}×`
                          : "queued"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
