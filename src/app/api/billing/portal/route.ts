import { apiError, json } from "@/server/api";
import { getCurrentUser } from "@/server/auth";
import { openBillingPortal } from "@/server/billing/service";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthenticated", "Sign in to manage billing.");
  const { url } = await openBillingPortal(user.id);
  return json({ url });
}
