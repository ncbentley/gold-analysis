import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtPct, fmtR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Bucket } from "@/server/statistics/compute";

/** Vertical bars of average R per bucket, with sample sizes. */
export function BucketColumns({ buckets, labels, className }: { buckets: Bucket[]; labels: string[]; className?: string }) {
  const max = Math.max(0.5, ...buckets.map((b) => Math.abs(b.avgR ?? 0)));
  return (
    <div className={cn("w-full", className)}>
      <div className="flex h-36 items-stretch gap-[3px]">
        {buckets.map((b, i) => {
          const v = b.avgR ?? 0;
          const h = (Math.abs(v) / max) * 50;
          return (
            <Tooltip key={i}>
              <TooltipTrigger
                render={
                  <div className="relative flex flex-1 flex-col justify-center rounded-sm transition-colors hover:bg-glow/10">
                    <div className="absolute inset-x-0 top-1/2 h-px bg-glow/35" />
                    {b.n > 0 && (
                      <div
                        className={cn(
                          "absolute inset-x-[15%]",
                          v >= 0
                            ? "rounded-t-[3px] bg-gradient-to-t from-win/45 to-win shadow-[0_0_10px_-3px_var(--win)]"
                            : "rounded-b-[3px] bg-gradient-to-b from-loss/45 to-loss shadow-[0_0_10px_-3px_var(--loss)]",
                        )}
                        style={v >= 0 ? { bottom: "50%", height: `${h}%` } : { top: "50%", height: `${h}%` }}
                      />
                    )}
                  </div>
                }
              />
              <TooltipContent>
                <div className="text-xs">
                  <div className="font-medium">{labels[i]}</div>
                  {b.n ? (
                    <div>
                      {fmtR(b.avgR)} avg · {fmtPct(b.winRate)} win · n = {b.n}
                    </div>
                  ) : (
                    <div>No closed trades</div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
      <div className="mt-1 flex gap-[3px] text-[10px] text-muted-foreground">
        {labels.map((l, i) => (
          <div key={i} className="flex-1 truncate text-center">
            {buckets.length > 12 ? (i % 3 === 0 ? l : "") : l}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Table-like rows for categorical buckets (direction, session, type). */
export function BucketRows({ buckets }: { buckets: Record<string, Bucket> }) {
  const entries = Object.entries(buckets).sort((a, b) => b[1].n - a[1].n);
  if (!entries.length) return <p className="text-sm text-muted-foreground">No data yet.</p>;
  const max = Math.max(0.5, ...entries.map(([, b]) => Math.abs(b.avgR ?? 0)));
  return (
    <div className="space-y-2.5">
      {entries.map(([k, b]) => {
        const up = (b.avgR ?? 0) >= 0;
        return (
          <div key={k} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 text-sm">
            <div className="truncate font-medium capitalize text-foreground/85">{k.toLowerCase()}</div>
            <div className="relative h-2 rounded-full bg-glow/10 ring-1 ring-glow/15">
              <div
                className={cn(
                  "absolute top-0 h-2",
                  up ? "left-1/2 rounded-r-full bg-gradient-to-r from-win/50 to-win shadow-[0_0_8px_-2px_var(--win)]" : "right-1/2 rounded-l-full bg-gradient-to-l from-loss/50 to-loss shadow-[0_0_8px_-2px_var(--loss)]",
                )}
                style={{ width: `${(Math.abs(b.avgR ?? 0) / max) * 50}%` }}
              />
              <div className="absolute left-1/2 top-[-3px] h-3.5 w-px bg-primary/70" />
            </div>
            <div className="w-40 text-right text-xs tabular-nums text-muted-foreground">
              <span className={cn("font-mono font-semibold", up ? "text-win" : "text-loss")}>{fmtR(b.avgR)}</span> · {fmtPct(b.winRate)} · n={b.n}
            </div>
          </div>
        );
      })}
    </div>
  );
}
