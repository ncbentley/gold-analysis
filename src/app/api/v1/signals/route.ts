import { apiError, json, withViewer } from "@/server/api";
import { can, lowestTierWith } from "@/server/entitlements/access";
import { listSignalsForViewer, parseSignalFilters } from "@/server/signals/queries";

export async function GET(req: Request) {
  return withViewer(async (viewer) => {
    if (!can(viewer.access, "signals.core")) {
      return apiError(403, "plan_required", "An active membership is required.", { requiredTier: lowestTierWith("signals.core", viewer.config) });
    }
    const params = new URL(req.url).searchParams;
    const limit = Math.min(100, Math.max(1, Number(params.get("limit") ?? 50) || 50));
    const offset = Math.max(0, Number(params.get("offset") ?? 0) || 0);
    const result = await listSignalsForViewer(viewer, parseSignalFilters(params), { limit, offset });
    return json({
      data: result.items,
      total: result.total,
      limit,
      offset,
      historyCutoff: result.historyCutoff,
      ignoredFilters: result.ignoredFilters,
    });
  });
}
