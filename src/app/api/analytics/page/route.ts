import { cookies } from "next/headers";
import { userFromSessionToken, SESSION_COOKIE } from "@/server/auth";
import { ATTR_COOKIE, VID_COOKIE, decodeAttribution, validVisitorId } from "@/server/analytics/attribution";
import { acceptPagePath } from "@/server/analytics/page-view";
import { capturePostHog, capturedProperties } from "@/server/analytics/posthog";

export async function POST(req: Request) {
  let pathname: string | null = null;
  try {
    const body = (await req.json()) as { pathname?: unknown };
    pathname = acceptPagePath(body?.pathname);
  } catch {
    pathname = null;
  }
  if (!pathname) return new Response(null, { status: 204 });
  try {
    const jar = await cookies();
    const visitorId = validVisitorId(jar.get(VID_COOKIE)?.value);
    if (!visitorId) return new Response(null, { status: 204 });
    const user = await userFromSessionToken(jar.get(SESSION_COOKIE)?.value);
    const attribution = decodeAttribution(jar.get(ATTR_COOKIE)?.value);
    capturePostHog(
      user?.id ?? visitorId,
      "$pageview",
      capturedProperties({ $pathname: pathname, $current_url: pathname }, attribution?.last ?? null, visitorId),
    );
  } catch (err) {
    console.warn("[analytics] dropped event", "$pageview", (err as Error).message);
  }
  return new Response(null, { status: 204 });
}
