import { getRecentBars } from "@/server/market-data";
import { publishBoardCards } from "@/server/board/service";
import { closeRetiredGold, collapseDuplicateGold, reconcileGoldBook } from "@/server/gold/from-board";
import { publishIdeaPhases } from "@/server/ideas/service";

/** Recomputes stored labels from the latest bars. The dashboard cache is written separately, and only if those labels changed. */
export async function relabelFeed() {
  const [bar] = (await getRecentBars(1)).slice(-1);
  const spot = bar?.close ?? null;
  const ideas = await publishIdeaPhases(spot);
  const board = await publishBoardCards(spot);
  const gold = await closeRetiredGold();
  const reconciled = await reconcileGoldBook();
  const collapsed = await collapseDuplicateGold();
  return { ideas, board, gold: gold.length + reconciled.closed.length + reconciled.reopened.length + collapsed.length };
}
