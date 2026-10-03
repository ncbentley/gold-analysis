import { getRecentBars } from "@/server/market-data";
import { publishBoardCards } from "@/server/board/service";
import { publishIdeaPhases } from "@/server/ideas/service";

/** Recomputes stored labels from the latest bars. The dashboard cache is written separately, and only if those labels changed. */
export async function relabelFeed() {
  const [bar] = (await getRecentBars(1)).slice(-1);
  const spot = bar?.close ?? null;
  const ideas = await publishIdeaPhases(spot);
  const board = await publishBoardCards(spot);
  return { ideas, board };
}
