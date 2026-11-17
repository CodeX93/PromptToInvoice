"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { toast } from "@/components/ui/toast";
import { creditNoteAction, duplicateAction, recordPaymentAction } from "@/app/app/invoices/actions";

export interface InvoiceActionsProps {
  id: string;
  docType: "invoice" | "credit_note";
  publicUrl: string | null;
  canPay: boolean;
  canCredit: boolean;
  canWrite: boolean;
  amountDue: string;
  amountDueRaw: string;
  today: string;
}

export function InvoiceActions(p: InvoiceActionsProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [payOpen, setPayOpen] = useState(false);

  const go = (
    fn: () => Promise<{ ok: true; data: { id: string } } | { ok: false; error: string }>,
    msg: string,
  ) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return toast.error(r.error);
      toast.success(msg);
      router.push(`/app/invoices/${r.data.id}` as Route);
    });

  return (
    <div className="flex flex-wrap gap-2" aria-busy={pending}>
      <Button asChild variant="secondary" size="sm">
        <a href={`/app/invoices/${p.id}/pdf?download`}>Download PDF</a>
      </Button>
      {p.canPay ? (
        <Button size="sm" onClick={() => setPayOpen(true)}>
          Record payment
        </Button>
      ) : null}
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="More actions">
            More ⋯
          </Button>
        </MenuTrigger>
        <MenuContent>
          {p.publicUrl ? (
            <MenuItem
              onSelect={() =>
                void navigator.clipboard
                  .writeText(p.publicUrl ?? "")
                  .then(() => toast.success("Link copied."))
              }
            >
              Copy client link
            </MenuItem>
          ) : null}
          <MenuItem onSelect={() => window.open(`/app/invoices/${p.id}/pdf`, "_blank", "noopener")}>
            Open PDF
          </MenuItem>
          {p.canWrite ? (
            <>
              <MenuSeparator />
              <MenuItem
                onSelect={() => go(() => duplicateAction(p.id), "Draft created from this invoice.")}
              >
                Duplicate as new draft
              </MenuItem>
              {p.canCredit ? (
                <MenuItem
                  danger
                  onSelect={() =>
                    go(() => creditNoteAction(p.id), "Credit note drafted. Review and issue it.")
                  }
                >
                  Correct with credit note…
                </MenuItem>
              ) : null}
            </>
          ) : null}
        </MenuContent>
      </Menu>
      <PaymentDialog open={payOpen} onOpenChange={setPayOpen} {...p} />
    </div>
  );
}

function PaymentDialog({
  open,
  onOpenChange,
  id,
  amountDue,
  amountDueRaw,
  today,
}: InvoiceActionsProps & { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Record a payment" description={`Outstanding: ${amountDue}`}>
        <form
          className="grid gap-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const get = (k: string) => {
              const v = fd.get(k);
              return typeof v === "string" ? v : "";
            };
            start(async () => {
              const r = await recordPaymentAction(id, {
                amount: get("amount"),
                receivedOn: get("receivedOn"),
                method: get("method") as "bank_transfer",
                reference: get("reference"),
                notes: "",
              });
              if (!r.ok) {
                setErrors(r.fieldErrors ?? {});
                return toast.error(r.error);
              }
              toast.success("Payment recorded.");
              onOpenChange(false);
              router.refresh();
            });
          }}
        >
          <Field label="Amount" error={errors.amount}>
            {(f) => (
              <Input
                id={f.id}
                name="amount"
                defaultValue={amountDueRaw}
                inputMode="decimal"
                className="figures"
                required
              />
            )}
          </Field>
          <Field label="Received on" error={errors.receivedOn}>
            {(f) => (
              <Input
                id={f.id}
                name="receivedOn"
                type="date"
                defaultValue={today}
                max={today}
                className="figures"
                required
              />
            )}
          </Field>
          <Field label="Method">
            {(f) => (
              <Select id={f.id} name="method" defaultValue="bank_transfer">
                <option value="bank_transfer">Bank transfer</option>
                <option value="cash">Cash</option>
                <option value="check">Check</option>
                <option value="other">Other</option>
              </Select>
            )}
          </Field>
          <Field label="Reference" optional>
            {(f) => <Input id={f.id} name="reference" placeholder="Bank reference" />}
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" pending={pending}>
              Record payment
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
