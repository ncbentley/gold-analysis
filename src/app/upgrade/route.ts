import type { NextRequest } from "next/server";
import { trackEvent } from "@/server/analytics";
import { getCurrentUser } from "@/server/auth";

export async function GET(req: NextRequest) {
  const tier = req.nextUrl.searchParams.get("tier") ?? "";
  const feature = req.nextUrl.searchParams.get("feature") ?? "";
  const user = await getCurrentUser();
  await trackEvent("upgrade_clicked", user?.id ?? null, { tier, feature });
  const location = ["silver", "gold", "platinum"].includes(tier) ? `/pricing?tier=${tier}` : "/pricing";
  return new Response(null, { status: 303, headers: { Location: location } });
}
