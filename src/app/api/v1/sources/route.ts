import { json, withViewer } from "@/server/api";
import { presentSourceSummary } from "@/server/presenters";
import { listSources } from "@/server/signals/queries";
import { getSourceStats } from "@/server/statistics/service";

export async function GET() {
  return withViewer(async (viewer) => {
    const sources = await listSources();
    const data = await Promise.all(sources.map(async (s) => presentSourceSummary(s, await getSourceStats(s.id), viewer.access, viewer.config)));
    return json({ data });
  });
}
