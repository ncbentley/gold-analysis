import { withTelegramSlot } from "@/server/jobs/limits";

export interface HistoryPage<T> {
  items: T[];
  /** Pass this as the next offset. Null means this was the last page. */
  nextOffset: number | null;
}

/**
 * Pages through channel history. Each page takes one Telegram slot, so parallel
 * imports stay within TELEGRAM_CONCURRENCY.
 */
export async function readHistoryPages<T>(loadPage: (offsetId: number) => Promise<HistoryPage<T>>, limit: number): Promise<T[]> {
  const out: T[] = [];
  let offsetId = 0;
  while (out.length < limit) {
    const page = await withTelegramSlot(() => loadPage(offsetId));
    out.push(...page.items);
    if (page.nextOffset == null || page.items.length === 0) break;
    offsetId = page.nextOffset;
  }
  return out.slice(0, limit);
}
