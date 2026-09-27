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
                  <div className="relative flex flex-1 flex-col justify-center rounded-sm hover:bg-muted/50">
                    <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
                    {b.n > 0 && (
                      <div
                        className={cn("absolute inset-x-[15%] rounded-[2px]", v >= 0 ? "bg-win/70" : "bg-loss/70")}
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
    <div className="space-y-2">
      {entries.map(([k, b]) => (
        <div key={k} className="grid grid-cols-[minmax(0,7rem)_1fr_auto] items-center gap-3 text-sm">
          <div className="truncate capitalize text-muted-foreground">{k.toLowerCase()}</div>
          <div className="relative h-2 rounded-full bg-muted">
            <div
              className={cn("absolute top-0 h-2 rounded-full", (b.avgR ?? 0) >= 0 ? "left-1/2 bg-win/70" : "right-1/2 bg-loss/70")}
              style={{ width: `${(Math.abs(b.avgR ?? 0) / max) * 50}%` }}
            />
            <div className="absolute left-1/2 top-[-2px] h-3 w-px bg-foreground/30" />
          </div>
          <div className="w-40 text-right text-xs tabular-nums text-muted-foreground">
            <span className={cn("font-mono", (b.avgR ?? 0) >= 0 ? "text-win" : "text-loss")}>{fmtR(b.avgR)}</span> · {fmtPct(b.winRate)} · n={b.n}
          </div>
        </div>
      ))}
    </div>
  );
}
