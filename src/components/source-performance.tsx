import Link from "next/link";
import { BucketRows } from "@/components/bucket-chart";
import { GatedView } from "@/components/locked";
import { RValue, Stat } from "@/components/signal-bits";
import { fmtMinutes, fmtPct } from "@/lib/format";
import type { PresentedSourceStats } from "@/server/presenters";

function rTone(r: number | null | undefined) {
  if (r === null || r === undefined) return "blue" as const;
  return r > 0.05 ? ("win" as const) : r < -0.05 ? ("loss" as const) : ("blue" as const);
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-xs font-semibold text-[#8db6ff]">{children}</div>;
}

function NoClosedTrades({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-black/25 p-3.5 text-sm leading-relaxed text-muted-foreground ring-1 ring-glow/20">{children}</p>;
}

/** Name, sample size and headline numbers for one source. */
export function SourceSummary({ stats, name, href, userId }: { stats: PresentedSourceStats; name?: string; href?: string; userId?: string }) {
  return (
    <>
      <div className="text-xs text-muted-foreground">
        {name && (
          <>
            {href ? (
              <Link href={href} className="rounded font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">
                {name}
              </Link>
            ) : (
              <span className="font-semibold text-primary">{name}</span>
            )}
            {" · "}
          </>
        )}
        <span className="font-mono text-foreground/90">{plural(stats.totalSignals, "tracked signal")}</span> ·{" "}
        <span className="font-mono text-foreground/90">{stats.closedTrades}</span> closed
      </div>
      <div className="mt-3">
        {stats.closedTrades === 0 ? (
          <NoClosedTrades>No closed trades yet. Win rate and R appear once this source’s first trade closes.</NoClosedTrades>
        ) : (
          <GatedView gated={stats.summary} title="Source statistics" userId={userId} compact>
            {(s) => (
              <div className="grid grid-cols-2 gap-2">
                <Stat tone="gold" label="Win rate" value={fmtPct(s.winRate)} n={s.wins + s.losses + s.breakevens} />
                <Stat tone={rTone(s.avgR)} label="Average R" value={<RValue value={s.avgR} />} n={s.ratedTrades} />
                <Stat tone={rTone(s.expectancy)} label="Expectancy" value={<RValue value={s.expectancy} />} n={s.ratedTrades} />
                <Stat label="Avg duration" value={fmtMinutes(s.avgDurationMinutes)} />
              </div>
            )}
          </GatedView>
        )}
      </div>
    </>
  );
}

/** Direction, recent form and session breakdowns. `session` marks the session of the signal being viewed. */
export function SourceHistory({ stats, session, userId }: { stats: PresentedSourceStats; session?: string; userId?: string }) {
  if (stats.closedTrades === 0) return <NoClosedTrades>Direction, recent form and session breakdowns need closed trades.</NoClosedTrades>;
  return (
    <div className="space-y-5">
      <GatedView gated={stats.direction} title="Performance by direction" userId={userId} compact>
        {(b) => (
          <div>
            <SubLabel>By direction</SubLabel>
            <BucketRows buckets={b} />
          </div>
        )}
      </GatedView>
      <GatedView gated={stats.recent} title="Recent performance" userId={userId} compact>
        {(r) => (
          <div className="grid grid-cols-2 gap-2">
            <Stat tone={rTone(r.recent10.avgR)} label="Last 10 avg" value={<RValue value={r.recent10.avgR} />} n={r.recent10.n} hint={`${fmtPct(r.recent10.winRate)} win`} />
            <Stat tone={rTone(r.recent30.avgR)} label="Last 30 avg" value={<RValue value={r.recent30.avgR} />} n={r.recent30.n} hint={`${fmtPct(r.recent30.winRate)} win`} />
          </div>
        )}
      </GatedView>
      <GatedView gated={stats.extended} title="Session breakdown" userId={userId} compact>
        {(x) => (
          <div>
            <SubLabel>By session (UTC){session ? ` · this signal: ${session}` : ""}</SubLabel>
            <BucketRows buckets={x.bySession} />
          </div>
        )}
      </GatedView>
    </div>
  );
}
