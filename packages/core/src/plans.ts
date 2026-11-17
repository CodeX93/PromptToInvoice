/**
 * Plan catalogue and entitlement checks. Prices live in Stripe; this file
 * describes what each plan unlocks so enforcement never depends on a network call.
 */

export const PLAN_IDS = ["starter", "pro", "business", "enterprise"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export type Feature =
  | "ai_drafts"
  | "all_currencies"
  | "recurring"
  | "reminders"
  | "custom_branding"
  | "einvoice"
  | "advanced_reports"
  | "api"
  | "sso"
  | "remove_branding";

export interface PlanLimits {
  /** Issued invoices per calendar month; null = unlimited. */
  invoicesPerMonth: number | null;
  aiDraftsPerMonth: number | null;
  businessProfiles: number | null;
  includedSeats: number | null;
  features: ReadonlySet<Feature>;
}

const f = (...xs: Feature[]): ReadonlySet<Feature> => new Set(xs);

export const PLANS: Readonly<Record<PlanId, { name: string; limits: PlanLimits }>> = {
  starter: {
    name: "Starter",
    limits: {
      invoicesPerMonth: 5,
      aiDraftsPerMonth: 20,
      businessProfiles: 1,
      includedSeats: 1,
      features: f("ai_drafts"),
    },
  },
  pro: {
    name: "Professional",
    limits: {
      invoicesPerMonth: null,
      aiDraftsPerMonth: 500,
      businessProfiles: 1,
      includedSeats: 1,
      features: f("ai_drafts", "all_currencies", "recurring", "reminders", "custom_branding", "einvoice", "remove_branding"),
    },
  },
  business: {
    name: "Business",
    limits: {
      invoicesPerMonth: null,
      aiDraftsPerMonth: 2000,
      businessProfiles: 5,
      includedSeats: 3,
      features: f(
        "ai_drafts",
        "all_currencies",
        "recurring",
        "reminders",
        "custom_branding",
        "einvoice",
        "advanced_reports",
        "remove_branding",
      ),
    },
  },
  enterprise: {
    name: "Enterprise",
    limits: {
      invoicesPerMonth: null,
      aiDraftsPerMonth: null,
      businessProfiles: null,
      includedSeats: null,
      features: f(
        "ai_drafts",
        "all_currencies",
        "recurring",
        "reminders",
        "custom_branding",
        "einvoice",
        "advanced_reports",
        "api",
        "sso",
        "remove_branding",
      ),
    },
  },
};

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === "string" && (PLAN_IDS as readonly string[]).includes(v);
}

export function hasFeature(plan: PlanId, feature: Feature): boolean {
  return PLANS[plan].limits.features.has(feature);
}

export type QuotaKey = "invoicesPerMonth" | "aiDraftsPerMonth" | "businessProfiles";

export interface QuotaCheck {
  allowed: boolean;
  limit: number | null;
  used: number;
  remaining: number | null;
}

/** `extraSeats` are purchased add-ons; returns null for unlimited. */
export function seatLimit(plan: PlanId, extraSeats = 0): number | null {
  const base = PLANS[plan].limits.includedSeats;
  return base === null ? null : base + extraSeats;
}

export function checkQuota(plan: PlanId, key: QuotaKey, used: number, increment = 1): QuotaCheck {
  const limit = PLANS[plan].limits[key];
  if (limit === null) return { allowed: true, limit, used, remaining: null };
  return { allowed: used + increment <= limit, limit, used, remaining: Math.max(0, limit - used) };
}

/** The cheapest plan that unlocks a feature — used for upgrade prompts. */
export function minimumPlanFor(feature: Feature): PlanId {
  return PLAN_IDS.find((p) => hasFeature(p, feature)) ?? "enterprise";
}
