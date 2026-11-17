"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { ClientForm, type ClientFormValues } from "@/components/clients/client-form";
import { archiveClient, checkClientVat } from "../actions";

export function ClientHeaderActions({
  values,
  countries,
  archived,
  hasVat,
}: {
  values: ClientFormValues & { id: string };
  countries: { code: string; name: string }[];
  archived: boolean;
  hasVat: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-2" aria-busy={pending}>
      {hasVat ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            start(async () => {
              const r = await checkClientVat(values.id);
              if (!r.ok) return toast.error(r.error);
              const s = r.data.status;
              if (s === "valid")
                toast.success(`VAT number valid${r.data.name ? `: ${r.data.name}` : ""}.`);
              else if (s === "invalid") toast.error("VIES says this VAT number is not valid.");
              else if (s === "malformed") toast.error("That isn't a valid EU VAT number format.");
              else toast("VIES is unavailable right now. Try again later.");
              router.refresh();
            })
          }
        >
          Verify VAT
        </Button>
      ) : null}
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          start(async () => {
            const r = await archiveClient(values.id, !archived);
            if (!r.ok) toast.error(r.error);
            else router.refresh();
          })
        }
      >
        {archived ? "Restore" : "Archive"}
      </Button>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Edit
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={`Edit ${values.name}`} wide>
          <ClientForm
            values={values}
            countries={countries}
            onSaved={() => {
              setOpen(false);
              router.refresh();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
