import { getRecentBars } from "@/server/market-data";
import { bumpFeedRevision, publishBoardCards } from "@/server/board/service";
import { publishIdeaPhases } from "@/server/ideas/service";

/** Recomputes stored dashboard labels from the latest bars. Pages only read the result. */
export async function relabelFeed() {
  const [bar] = (await getRecentBars(1)).slice(-1);
  const spot = bar?.close ?? null;
  const ideas = await publishIdeaPhases(spot);
  const board = await publishBoardCards(spot);
  if (ideas > 0 || board) await bumpFeedRevision();
  return { ideas, board };
}
