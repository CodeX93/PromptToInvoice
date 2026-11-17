/** Client-safe mirror of ActionResult for useActionState initial values. */
export type ActionState<T = undefined> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: string;
      code: string;
      fieldErrors?: Record<string, string[]>;
      ref?: string;
    };

export const initialActionState: ActionState = { ok: true, data: undefined };

/** Show an action error; quota errors link to billing. */
export function errorToast(
  r: { error: string; code: string },
  toastFn: {
    error: (m: string) => void;
    action: (m: string, a: { label: string; href: string }) => void;
  },
): void {
  if (r.code === "quota_exceeded")
    toastFn.action(r.error, { label: "See plans", href: "/app/settings/billing" });
  else toastFn.error(r.error);
}
