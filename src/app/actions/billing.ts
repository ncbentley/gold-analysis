"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { completeMockCheckout, openBillingPortal, setCancelAtPeriodEnd, startCheckout } from "@/server/billing/service";
import { PERIODS, TIERS, type BillingPeriod, type Tier } from "@/server/db/schema";

function parsePlan(form: FormData) {
  const tier = String(form.get("tier"));
  const period = String(form.get("period"));
  if (!(TIERS as readonly string[]).includes(tier) || !(PERIODS as readonly string[]).includes(period)) throw new Error("Invalid plan");
  return { tier: tier as Tier, period: period as BillingPeriod };
}

export async function checkoutAction(form: FormData) {
  const { tier, period } = parsePlan(form);
  const user = await getCurrentUser();
  if (!user) redirect(`/signup?next=${encodeURIComponent(`/billing?tier=${tier}&period=${period}#plans`)}`);
  if (!user.emailVerifiedAt) redirect(`/check-email?email=${encodeURIComponent(user.email)}&reason=checkout`);
  const { url } = await startCheckout(user, tier, period);
  redirect(url);
}

export async function confirmMockCheckoutAction(form: FormData) {
  const { tier, period } = parsePlan(form);
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.emailVerifiedAt) redirect(`/check-email?email=${encodeURIComponent(user.email)}&reason=checkout`);
  await completeMockCheckout(user.id, tier, period);
  redirect("/billing?checkout=success");
}

export async function cancelSubscriptionAction() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await setCancelAtPeriodEnd(user.id, true, { userId: user.id, label: user.email });
  revalidatePath("/billing");
}

export async function resumeSubscriptionAction() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  await setCancelAtPeriodEnd(user.id, false, { userId: user.id, label: user.email });
  revalidatePath("/billing");
}

export async function billingPortalAction() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { url } = await openBillingPortal(user.id);
  redirect(url);
}
