import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ATTR_COOKIE, TOUCH_HEADER, VID_COOKIE, advanceAttribution, decodeAttribution, encodeAttribution, touchFromRequest } from "@/server/analytics/attribution";

const YEAR_SECONDS = 400 * 24 * 60 * 60;

export function proxy(request: NextRequest) {
  const existing = decodeAttribution(request.cookies.get(ATTR_COOKIE)?.value);
  const visitorId = request.cookies.get(VID_COOKIE)?.value ?? null;
  const touch = touchFromRequest({
    pathname: request.nextUrl.pathname,
    searchParams: request.nextUrl.searchParams.entries(),
    referrer: request.headers.get("referer"),
    requestHost: request.nextUrl.host,
  });
  const { state, write } = advanceAttribution(existing, visitorId, touch);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(TOUCH_HEADER);
  if (write) requestHeaders.set(TOUCH_HEADER, encodeAttribution(state));

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  const cookie = {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: YEAR_SECONDS,
  };
  if (visitorId !== state.visitorId) response.cookies.set(VID_COOKIE, state.visitorId, cookie);
  if (write) response.cookies.set(ATTR_COOKIE, encodeAttribution(state), cookie);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
