"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Route } from "next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ClientForm, emptyClient } from "./client-form";

export function NewClientButton({ countries }: { countries: { code: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>New client</Button>
      </DialogTrigger>
      <DialogContent title="New client" wide>
        <ClientForm
          values={emptyClient}
          countries={countries}
          onSaved={(id) => {
            setOpen(false);
            router.push(`/app/clients/${id}` as Route);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
