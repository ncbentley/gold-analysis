import { json, withViewer } from "@/server/api";
import { loadSignalForApi } from "@/server/signals/api";

export async function GET(_req: Request, ctx: RouteContext<"/api/v1/signals/[id]/analysis">) {
  const { id } = await ctx.params;
  return withViewer(async (viewer) => {
    const r = await loadSignalForApi(id, viewer);
    if ("error" in r) return r.error;
    return json({ data: r.detail.ai });
  });
}
