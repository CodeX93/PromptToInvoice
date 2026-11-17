"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { setStatus } from "./actions";

export function ScheduleRowActions({
  id,
  status,
}: {
  id: string;
  status: "active" | "paused" | "ended";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (s: "active" | "paused" | "ended") =>
    start(async () => {
      const r = await setStatus(id, s);
      if (!r.ok) toast.error(r.error);
      else router.refresh();
    });
  if (status === "ended") return <span className="text-ink-4 text-xs">Ended</span>;
  return (
    <span className="inline-flex gap-1" aria-busy={pending}>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => go(status === "active" ? "paused" : "active")}
      >
        {status === "active" ? "Pause" : "Resume"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() =>
          confirm("End this schedule? No more invoices will be created.") && go("ended")
        }
      >
        End
      </Button>
    </span>
  );
}
