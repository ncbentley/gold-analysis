import { getEngineBars } from "@/server/market-data";
import { settleClose } from "./settle";
import { listGoldEntries, markGoldExit } from "./store";

/** Prices Gold closes from the next stored minute bar. Does not touch signal outcomes. */
export async function settleStoredGoldCloses() {
  const rows = await listGoldEntries();
  let settled = 0;
  for (const row of rows) {
    if (!row.closeCalledAt || row.exitTime || !row.sectionAtCall) continue;
    const calledAt = row.closeCalledAt.getTime();
    const bars = await getEngineBars(new Date(calledAt), new Date(calledAt + 2 * 60_000));
    const exit = settleClose({ sectionAtCall: row.sectionAtCall, calledAt }, bars);
    if (!exit) continue;
    await markGoldExit(row.ideaId, { exitTime: new Date(exit.exitTime), exitPrice: exit.exitPrice, retired: exit.retired });
    settled += 1;
  }
  return settled;
}
