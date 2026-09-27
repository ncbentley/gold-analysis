import { apiError, json, withViewer } from "@/server/api";
import { presentSourceSummary } from "@/server/presenters";
import { getSourceBySlugOrId } from "@/server/signals/queries";
import { getSourceStats } from "@/server/statistics/service";

export async function GET(_req: Request, ctx: RouteContext<"/api/v1/sources/[id]">) {
  const { id } = await ctx.params;
  return withViewer(async (viewer) => {
    const source = await getSourceBySlugOrId(id);
    if (!source || (!source.active && !viewer.access.isAdmin)) return apiError(404, "not_found", "Source not found.");
    return json({ data: presentSourceSummary(source, await getSourceStats(source.id), viewer.access, viewer.config) });
  });
}
