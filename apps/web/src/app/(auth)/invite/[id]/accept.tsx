"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient, authErrorMessage } from "@/lib/auth-client";

export function AcceptInvitation({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function respond(kind: "accept" | "decline") {
    setPending(kind);
    setError(null);
    const { error: err } =
      kind === "accept"
        ? await authClient.organization.acceptInvitation({ invitationId: id })
        : await authClient.organization.rejectInvitation({ invitationId: id });
    if (err) {
      setPending(null);
      setError(authErrorMessage(err));
      return;
    }
    router.replace(kind === "accept" ? "/app" : "/");
    router.refresh();
  }

  return (
    <div className="mt-8 flex flex-col gap-3">
      {error ? <p role="alert" className="border-danger bg-danger-soft text-danger border-l-2 px-3 py-2 text-sm">{error}</p> : null}
      <Button size="lg" pending={pending === "accept"} disabled={pending !== null} onClick={() => respond("accept")}>
        Accept and join
      </Button>
      <Button variant="ghost" disabled={pending !== null} onClick={() => respond("decline")}>
        Decline
      </Button>
    </div>
  );
}
