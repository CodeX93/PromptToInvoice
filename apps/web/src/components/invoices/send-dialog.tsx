"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/field";
import { toast } from "@/components/ui/toast";
import { sendInvoiceAction } from "@/app/app/invoices/actions";

const split = (s: string) =>
  s
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

export function SendDialog({
  id,
  open,
  onOpenChange,
  defaultTo,
  number,
  sentBefore,
}: {
  id: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defaultTo: string[];
  number: string;
  sentBefore: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={sentBefore ? `Send ${number} again` : `Send ${number}`}
        description="The PDF is attached, with a link to view and pay online."
        wide
      >
        <form
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const v = (k: string) => {
              const x = fd.get(k);
              return typeof x === "string" ? x : "";
            };
            start(async () => {
              const r = await sendInvoiceAction(id, {
                to: split(v("to")),
                cc: split(v("cc")),
                message: v("message"),
              });
              if (!r.ok) {
                setErrors(r.fieldErrors ?? {});
                return toast.error(r.error);
              }
              toast.success("Queued for sending. It'll show as sent in a moment.");
              onOpenChange(false);
              router.refresh();
            });
          }}
        >
          <Field
            label="To"
            error={errors.to ?? errors["to.0"]}
            hint="Separate several addresses with commas."
          >
            {(f) => (
              <Input
                id={f.id}
                name="to"
                defaultValue={defaultTo.join(", ")}
                required
                inputMode="email"
              />
            )}
          </Field>
          <Field label="Cc" optional error={errors["cc.0"]}>
            {(f) => <Input id={f.id} name="cc" inputMode="email" />}
          </Field>
          <Field label="Message" optional>
            {(f) => (
              <Textarea
                id={f.id}
                name="message"
                rows={4}
                placeholder="Hi, please find the invoice attached. Thanks!"
                maxLength={2000}
              />
            )}
          </Field>
          <div>
            <Button type="submit" pending={pending}>
              Send invoice
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
