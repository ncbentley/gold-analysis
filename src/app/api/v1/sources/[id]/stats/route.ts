import { apiError, json, withViewer } from "@/server/api";
import { presentSourceStats } from "@/server/presenters";
import { getSourceBySlugOrId } from "@/server/signals/queries";
import { getSourceStats, getSourceStatsMeta } from "@/server/statistics/service";

export async function GET(_req: Request, ctx: RouteContext<"/api/v1/sources/[id]/stats">) {
  const { id } = await ctx.params;
  return withViewer(async (viewer) => {
    const source = await getSourceBySlugOrId(id, { includeQa: viewer.access.isAdmin });
    if (!source || (!source.active && !viewer.access.isAdmin)) return apiError(404, "not_found", "Source not found.");
    const [stats, meta] = await Promise.all([getSourceStats(source.id), getSourceStatsMeta(source.id)]);
    return json({ data: presentSourceStats(stats, viewer.access, viewer.config), computedAt: meta?.computedAt ?? null });
  });
}
