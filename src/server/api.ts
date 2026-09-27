import { NextResponse } from "next/server";
import { getViewer, type Viewer } from "@/server/entitlements/service";

export function json(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

export function apiError(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return json({ error: { code, message, ...extra } }, status);
}

/** Resolves the session viewer for API routes; unauthenticated callers get 401. */
export async function withViewer(fn: (viewer: Viewer) => Promise<Response>): Promise<Response> {
  const viewer = await getViewer();
  if (!viewer.user) return apiError(401, "unauthenticated", "Sign in to use the API.");
  return fn(viewer);
}

export function accessPayload(viewer: Viewer) {
  return {
    tier: viewer.access.tier,
    isAdmin: viewer.access.isAdmin,
    historyDays: viewer.access.historyDays,
    features: [...viewer.access.features].sort(),
  };
}
