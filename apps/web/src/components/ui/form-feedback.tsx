"use client";

import { useEffect, useRef } from "react";
import type { ActionState } from "@/lib/action-state";
import { toast } from "./toast";

/**
 * Banner for non-field errors plus a success toast when a submission
 * completes. Tracks state identity so a toast fires once per submission.
 */
export function FormFeedback({
  state,
  success,
}: {
  state: ActionState<unknown>;
  success?: string;
}) {
  const last = useRef(state);
  useEffect(() => {
    if (state === last.current) return;
    last.current = state;
    if (state.ok && success) toast.success(success);
  }, [state, success]);

  if (state.ok || state.fieldErrors) return null;
  return (
    <p
      role="alert"
      className="border-danger bg-danger-soft text-danger border-l-2 px-3 py-2 text-sm"
    >
      {state.error}
    </p>
  );
}

export function fieldErrors(state: ActionState<unknown>): Record<string, string[]> {
  return state.ok ? {} : (state.fieldErrors ?? {});
}
