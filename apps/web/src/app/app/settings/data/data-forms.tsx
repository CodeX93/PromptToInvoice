"use client";

import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { FormFeedback, fieldErrors } from "@/components/ui/form-feedback";
import { toast } from "@/components/ui/toast";
import { initialActionState } from "@/lib/action-state";
import { deleteOrg, exportData } from "./actions";

export function ExportButton() {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      pending={pending}
      onClick={() =>
        start(async () => {
          const r = await exportData();
          if (r.ok) toast.success("Export started. We'll email you a download link shortly.");
          else toast.error(r.error);
        })
      }
    >
      Export all data
    </Button>
  );
}

export function DeleteOrgForm({ orgName }: { orgName: string }) {
  const [state, action, pending] = useActionState(deleteOrg, initialActionState);
  const [typed, setTyped] = useState("");
  return (
    <form action={action} className="grid max-w-md gap-4">
      <Field label={`Type “${orgName}” to confirm`} error={fieldErrors(state).confirm}>
        {(f) => <Input id={f.id} name="confirm" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />}
      </Field>
      <Button type="submit" variant="danger" pending={pending} disabled={typed !== orgName} className="justify-self-start">
        Delete organisation
      </Button>
      <FormFeedback state={state} />
    </form>
  );
}
