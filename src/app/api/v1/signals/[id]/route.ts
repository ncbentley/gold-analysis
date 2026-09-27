import { json, withViewer } from "@/server/api";
import { loadSignalForApi } from "@/server/signals/api";

export async function GET(_req: Request, ctx: RouteContext<"/api/v1/signals/[id]">) {
  const { id } = await ctx.params;
  return withViewer(async (viewer) => {
    const r = await loadSignalForApi(id, viewer);
    if ("error" in r) return r.error;
    const signal: Partial<typeof r.detail> = { ...r.detail };
    delete signal.similar;
    delete signal.ai;
    delete signal.sourceStats;
    return json({ data: signal });
  });
}
