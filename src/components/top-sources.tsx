import { Lock } from "lucide-react";
import Link from "next/link";
import { RValue } from "@/components/signal-bits";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TOP_SOURCES_MIN_TRADES } from "@/server/statistics/compute";

export type TopSourceRow = {
  sourceId: string;
  name: string;
  closedTrades: number;
  metrics: { winRate: number | null; expectancy: number | null } | null;
};

function Rank({ n }: { n: number }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full font-heading text-sm font-extrabold",
        n === 1
          ? "gold-fill shadow-[0_0_14px_-3px_rgb(245_197_66/0.7)]"
          : n <= 3
            ? "bg-primary/10 text-primary ring-1 ring-primary/55"
            : "bg-glow/10 text-[#8db6ff] ring-1 ring-glow/45",
      )}
    >
      {n}
    </span>
  );
}

export function TopSources({
  rows,
  eligibleCount,
  sourceCount,
  lockedHref,
  hrefBase,
}: {
  rows: TopSourceRow[];
  eligibleCount: number;
  sourceCount: number;
  lockedHref?: string;
  /** Links each name to its source page. Left off for anonymous visitors. */
  hrefBase?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-glow/30 bg-glow/[0.03] p-8 text-center text-sm text-muted-foreground">
        Rankings appear once a source has {TOP_SOURCES_MIN_TRADES} closed trades.
      </div>
    );
  }
  const locked = rows.some((r) => !r.metrics);
  return (
    <div className="panel overflow-hidden rounded-xl shadow-[0_0_24px_-12px_rgb(47_123_255/0.6)] ring-1 ring-glow/30">
      <Table>
        <TableHeader>
          <TableRow className="bg-black/20 hover:bg-black/20">
            <TableHead className="w-14">Rank</TableHead>
            <TableHead>Source</TableHead>
            <TableHead className="text-right">Closed trades</TableHead>
            <TableHead className="text-right">Win rate</TableHead>
            <TableHead className="text-right">Expectancy</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={r.sourceId}>
              <TableCell>
                <Rank n={i + 1} />
              </TableCell>
              <TableCell className="font-medium text-foreground/90">
                {hrefBase ? (
                  <Link href={`${hrefBase}/${r.sourceId}`} className="rounded outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                    {r.name}
                  </Link>
                ) : (
                  r.name
                )}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">{r.closedTrades}</TableCell>
              {r.metrics ? (
                <>
                  <TableCell className={cn("text-right font-mono tabular-nums", i === 0 && "gold-text font-bold")}>{fmtPct(r.metrics.winRate)}</TableCell>
                  <TableCell className="text-right">
                    <RValue value={r.metrics.expectancy} className="font-semibold" />
                  </TableCell>
                </>
              ) : (
                <TableCell colSpan={2} className="text-right text-muted-foreground">
                  <Lock className="ml-auto size-4" aria-label="Locked" />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-glow/15 bg-black/20 px-3 py-2.5 text-xs text-muted-foreground">
        <span>
          Ranked by expectancy among the {eligibleCount} of {sourceCount} sources with at least {TOP_SOURCES_MIN_TRADES} closed trades.
        </span>
        {locked && lockedHref && (
          <Link href={lockedHref} className="font-semibold text-primary hover:underline">
            Win rate and expectancy are included with Gold
          </Link>
        )}
      </div>
    </div>
  );
}
