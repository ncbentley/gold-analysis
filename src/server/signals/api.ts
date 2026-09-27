import { apiError } from "@/server/api";
import type { Viewer } from "@/server/entitlements/service";
import { getSignalDetailForViewer, type SignalDetailResult } from "./queries";

type Ok = Extract<SignalDetailResult, { kind: "ok" }>["detail"];

/** Shared loader for /api/v1/signals/:id and its sub-resources. */
export async function loadSignalForApi(id: string, viewer: Viewer): Promise<{ detail: Ok } | { error: Response }> {
  const res = await getSignalDetailForViewer(id, viewer);
  if (res.kind === "not_found") return { error: apiError(404, "not_found", "Signal not found.") };
  if (res.kind === "no_access") return { error: apiError(403, "plan_required", "An active membership is required.", { requiredTier: res.requiredTier }) };
  if (res.kind === "history_locked") {
    return { error: apiError(403, "history_locked", "This signal is outside your plan's history window.", { requiredTier: res.requiredTier }) };
  }
  return { detail: res.detail };
}
