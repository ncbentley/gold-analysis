import { NextResponse, type NextRequest } from "next/server";
import { trackEvent } from "@/server/analytics";
import { getCurrentUser } from "@/server/auth";

export async function GET(req: NextRequest) {
  const tier = req.nextUrl.searchParams.get("tier") ?? "";
  const feature = req.nextUrl.searchParams.get("feature") ?? "";
  const user = await getCurrentUser();
  await trackEvent("upgrade_clicked", user?.id ?? null, { tier, feature });
  const url = new URL("/pricing", req.nextUrl.origin);
  if (["silver", "gold", "platinum"].includes(tier)) url.searchParams.set("tier", tier);
  return NextResponse.redirect(url, 303);
}
