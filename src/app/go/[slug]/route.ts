import { NextResponse, type NextRequest } from "next/server";
import { recordAffiliateClick } from "@/server/affiliates";
import { trackEvent } from "@/server/analytics";
import { getCurrentUser } from "@/server/auth";

export async function GET(req: NextRequest, ctx: RouteContext<"/go/[slug]">) {
  const { slug } = await ctx.params;
  const user = await getCurrentUser();
  const link = await recordAffiliateClick(slug, user?.id ?? null);
  if (!link) return NextResponse.redirect(new URL("/", req.nextUrl.origin));
  await trackEvent("affiliate_link_clicked", user?.id ?? null, { slug });
  return NextResponse.redirect(link.destinationUrl, 302);
}
