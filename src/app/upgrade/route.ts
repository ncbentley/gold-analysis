import type { NextRequest } from "next/server";
import { trackEvent } from "@/server/analytics";
import { getCurrentUser } from "@/server/auth";
import { TIERS } from "@/server/db/schema";

export async function GET(req: NextRequest) {
  const tier = req.nextUrl.searchParams.get("tier") ?? "";
  const feature = req.nextUrl.searchParams.get("feature") ?? "";
  const user = await getCurrentUser();
  await trackEvent("upgrade_clicked", user?.id ?? null, { tier, feature });
  const query = (TIERS as readonly string[]).includes(tier) ? `?tier=${tier}` : "";
  const location = user ? `/billing${query}#plans` : `/pricing${query}`;
  return new Response(null, { status: 303, headers: { Location: location } });
}
