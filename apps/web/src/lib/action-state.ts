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
