import { NextResponse } from "next/server";
import { recordAffiliateClick } from "@/server/affiliates";
import { trackEvent } from "@/server/analytics";
import { getCurrentUser } from "@/server/auth";

export async function GET(_req: Request, ctx: RouteContext<"/go/[slug]">) {
  const { slug } = await ctx.params;
  const user = await getCurrentUser();
  const link = await recordAffiliateClick(slug, user?.id ?? null);
  if (!link) return new Response(null, { status: 307, headers: { Location: "/" } });
  await trackEvent("affiliate_link_clicked", user?.id ?? null, { slug });
  return NextResponse.redirect(link.destinationUrl, 302);
}
