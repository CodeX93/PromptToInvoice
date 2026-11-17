"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";
import { orgContextOrThrow } from "@/server/session";
import { billingPortal, subscriptionCheckout } from "@/server/services/billing";
import { str } from "@/lib/form-data";

export async function upgrade(fd: FormData): Promise<void> {
  const ctx = await orgContextOrThrow();
  const plan = str(fd, "plan") === "business" ? "business" : "pro";
  const interval = str(fd, "interval") === "year" ? "year" : "month";
  redirect((await subscriptionCheckout(ctx, plan, interval)) as Route);
}

export async function manageBilling(): Promise<void> {
  const ctx = await orgContextOrThrow();
  redirect((await billingPortal(ctx)) as Route);
}
