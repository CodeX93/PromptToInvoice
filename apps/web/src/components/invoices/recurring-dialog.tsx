"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { makeRecurringAction } from "@/app/app/invoices/actions";

export function RecurringDialog({ id, open, onOpenChange, startOn }: { id: string; open: boolean; onOpenChange: (o: boolean) => void; startOn: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Repeat this invoice" description="A new invoice with the same lines is created on each date, with dates and numbering updated.">
        <form
          className="grid gap-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const input = Object.fromEntries(new FormData(e.currentTarget));
            start(async () => {
              const r = await makeRecurringAction(id, { ...input, endsOn: input.endsOn || null, remainingRuns: input.remainingRuns || null });
              if (!r.ok) {
                setErrors(r.fieldErrors ?? {});
                return toast.error(r.error);
              }
              toast.success("Recurring schedule created.");
              onOpenChange(false);
              router.refresh();
            });
          }}
        >
          <Field label="Every">{(f) => <Input id={f.id} name="intervalCount" type="number" min={1} max={36} defaultValue={1} className="figures" />}</Field>
          <Field label="Period">
            {(f) => (
              <Select id={f.id} name="intervalUnit" defaultValue="month">
                <option value="week">week(s)</option>
                <option value="month">month(s)</option>
                <option value="year">year(s)</option>
              </Select>
            )}
          </Field>
          <Field label="First invoice on" error={errors.startOn}>{(f) => <Input id={f.id} name="startOn" type="date" defaultValue={startOn} min={startOn} className="figures" required />}</Field>
          <Field label="Ends on" optional>{(f) => <Input id={f.id} name="endsOn" type="date" className="figures" />}</Field>
          <Field label="Then" className="sm:col-span-2" error={errors.autoIssue}>
            {(f) => (
              <Select id={f.id} name="autoIssue" defaultValue="issue_and_send">
                <option value="issue_and_send">Issue and email it to the client</option>
                <option value="issue">Issue it (I'll send it myself)</option>
                <option value="draft">Create a draft for me to review</option>
              </Select>
            )}
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" pending={pending}>
              Start schedule
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
