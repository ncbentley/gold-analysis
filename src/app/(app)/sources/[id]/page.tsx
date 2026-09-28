import { ArrowLeft, Bot } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BucketColumns, BucketRows } from "@/components/bucket-chart";
import { GatedView } from "@/components/locked";
import { PageHeader } from "@/components/page-header";
import { RValue, Stat } from "@/components/signal-bits";
import { SignalList } from "@/components/signal-list";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDateTime, fmtMinutes, fmtPct } from "@/lib/format";
import { getCurrentAnalysis } from "@/server/ai/service";
import type { SourcePatternsOutput } from "@/server/ai/types";
import { trackEvent } from "@/server/analytics";
import { can, gate } from "@/server/entitlements/access";
import { getViewer } from "@/server/entitlements/service";
import { presentSourceStats, redactIdentities } from "@/server/presenters";
import { getSourceBySlugOrId, listSignalsForViewer } from "@/server/signals/queries";
import { getSourceStats, getSourceStatsMeta } from "@/server/statistics/service";

export const metadata: Metadata = { title: "Source" };

const HOURS = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}h`);
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Panel({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card className="bg-card/60">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export default async function SourcePage({ params }: PageProps<"/sources/[id]">) {
  const { id } = await params;
  const viewer = await getViewer();
  const source = await getSourceBySlugOrId(id, { includeQa: viewer.access.isAdmin, allowSlug: viewer.access.isAdmin });
  if (!source) notFound();
  const { access, config } = viewer;
  const uid = viewer.user?.id;
  void trackEvent("source_viewed", uid ?? null, { source: source.slug });

  const [raw, meta, recent] = await Promise.all([
    getSourceStats(source.id),
    getSourceStatsMeta(source.id),
    can(access, "signals.core") ? listSignalsForViewer(viewer, { sourceId: source.id }, { limit: 10 }) : Promise.resolve(null),
  ]);
  const s = presentSourceStats(raw, access, config);
  const veil = (value: string) => redactIdentities(value, [source.name, source.slug, source.telegramUsername]);
  const patterns = gate(access, "ai.patterns", config, () => null as null);
  const analysis = !patterns.locked ? await getCurrentAnalysis({ sourceId: source.id, analysisType: "source_patterns" }) : null;
  const ai = analysis?.outputJson as SourcePatternsOutput | undefined;

  return (
    <>
      <Link href="/sources" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Sources
      </Link>
      <PageHeader
        title="How this source performed"
        description="Win rate, R and recent form. The channel is not named."
        actions={
          <>
            {can(access, "sources.history.full") && (
              <Link href={`/signals?source=${source.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Full history
              </Link>
            )}
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Tracked signals" value={s.totalSignals} />
        <Stat label="Closed trades" value={s.closedTrades} />
        {s.summary.locked ? (
          <GatedView gated={s.summary} title="Win rate, average R, expectancy" userId={uid} compact className="col-span-2">
            {() => null}
          </GatedView>
        ) : (
          <>
            <Stat label="Win rate" value={fmtPct(s.summary.data.winRate)} n={s.closedTrades} hint={`${s.summary.data.wins}W · ${s.summary.data.losses}L · ${s.summary.data.breakevens}BE`} />
            <Stat label="Expectancy" value={<RValue value={s.summary.data.expectancy} />} n={s.summary.data.ratedTrades} hint={`avg win ${s.summary.data.avgWinR?.toFixed(2) ?? "—"}R · avg loss ${s.summary.data.avgLossR?.toFixed(2) ?? "—"}R`} />
          </>
        )}
      </div>
      {!s.summary.locked && (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Average R" value={<RValue value={s.summary.data.avgR} />} n={s.summary.data.ratedTrades} />
          <Stat label="Entered" value={s.summary.data.enteredSignals} hint={`${s.summary.data.expired} expired · ${s.summary.data.cancelled} cancelled`} />
          <Stat label="Ambiguous" value={s.summary.data.ambiguous} hint="stop & target in one candle" />
          <Stat label="Avg duration" value={fmtMinutes(s.summary.data.avgDurationMinutes)} n={s.closedTrades} />
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Recent performance" description="Most recent closed trades.">
          <GatedView gated={s.recent} title="Recent 10 / 30 trade performance" userId={uid} compact>
            {(r) => (
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Last 10 · avg R" value={<RValue value={r.recent10.avgR} />} n={r.recent10.n} hint={`${fmtPct(r.recent10.winRate)} win · Σ ${r.recent10.sumR.toFixed(2)}R`} />
                <Stat label="Last 30 · avg R" value={<RValue value={r.recent30.avgR} />} n={r.recent30.n} hint={`${fmtPct(r.recent30.winRate)} win · Σ ${r.recent30.sumR.toFixed(2)}R`} />
              </div>
            )}
          </GatedView>
        </Panel>
        <Panel title="MFE / MAE" description="How far trades moved for and against after entry, in R.">
          <GatedView gated={s.excursion} title="MFE / MAE summary" userId={uid} compact>
            {(x) => (
              <div className="grid grid-cols-2 gap-3">
                <Stat label="Avg MFE" value={x.avgMfeR === null ? "—" : `${x.avgMfeR.toFixed(2)}R`} n={x.n} />
                <Stat label="Avg MAE" value={x.avgMaeR === null ? "—" : `${x.avgMaeR.toFixed(2)}R`} n={x.n} />
              </div>
            )}
          </GatedView>
        </Panel>
        <Panel title="Performance by hour of day" description="Average R by the UTC hour the signal was published.">
          <GatedView gated={s.timeOfDay} title="Performance by time of day" userId={uid} compact>
            {(b) => <BucketColumns buckets={b} labels={HOURS} />}
          </GatedView>
        </Panel>
        <Panel title="Direction and signal type">
          <div className="space-y-5">
            <GatedView gated={s.direction} title="Performance by direction" userId={uid} compact>
              {(b) => <BucketRows buckets={b} />}
            </GatedView>
            <GatedView gated={s.signalType} title="Performance by signal type" userId={uid} compact>
              {(b) => <BucketRows buckets={b} />}
            </GatedView>
          </div>
        </Panel>
        <Panel title="Extended breakdowns" description="Day of week, session and entry type, plus distribution percentiles.">
          <GatedView gated={s.extended} title="Additional dimensions" userId={uid} compact>
            {(x) => (
              <div className="space-y-5">
                <BucketColumns buckets={x.byDayOfWeek} labels={DAYS} className="[&>div:first-child]:h-24" />
                <BucketRows buckets={x.bySession} />
                <BucketRows buckets={x.byEntryType} />
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <Stat label="Median R" value={<RValue value={x.medianR} />} />
                  <Stat label="MFE p25/p50/p75" value={<span className="text-sm">{x.mfeRPercentiles ? `${x.mfeRPercentiles.p25} / ${x.mfeRPercentiles.p50} / ${x.mfeRPercentiles.p75}` : "—"}</span>} />
                  <Stat label="MAE p25/p50/p75" value={<span className="text-sm">{x.maeRPercentiles ? `${x.maeRPercentiles.p25} / ${x.maeRPercentiles.p50} / ${x.maeRPercentiles.p75}` : "—"}</span>} />
                </div>
              </div>
            )}
          </GatedView>
        </Panel>
        <Panel title="Time to target" description="Minutes from fill to each target, for trades that reached it.">
          <GatedView gated={s.timeToTarget} title="Time-to-target statistics" userId={uid} compact>
            {(tt) =>
              tt.length ? (
                <div className="space-y-2">
                  {tt.map((t) => (
                    <div key={t.target} className="grid grid-cols-4 items-center rounded border p-2 text-sm">
                      <span className="font-medium">TP{t.target}</span>
                      <span className="text-xs text-muted-foreground">hit {fmtPct(t.hitRate)}</span>
                      <span className="text-xs">median {fmtMinutes(t.medianMinutes)}</span>
                      <span className="text-right text-xs text-muted-foreground">n = {t.n}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No target data yet.</p>
              )
            }
          </GatedView>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title="AI pattern analysis" description="Recurring patterns described from this source’s deterministic statistics.">
          <GatedView gated={patterns} title="AI pattern analysis" userId={uid} compact>
            {() =>
              ai ? (
                <div className="space-y-3">
                  <p className="font-medium">{veil(ai.headline)}</p>
                  <div className="grid gap-2 md:grid-cols-2">
                    {ai.patterns.map((p) => (
                      <div key={p.title} className="rounded-lg border bg-background/40 p-3">
                        <div className="text-sm font-medium">{veil(p.title)}</div>
                        <p className="mt-1 text-xs text-muted-foreground">{veil(p.detail)}</p>
                        <div className="mt-1 text-[11px] text-muted-foreground">n = {p.sampleSize}</div>
                      </div>
                    ))}
                  </div>
                  <ul className="text-xs text-muted-foreground">{ai.caveats.map((c) => <li key={c}>• {veil(c)}</li>)}</ul>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Bot className="size-3.5" /> {analysis?.model} · {analysis?.promptVersion} · {fmtDateTime(analysis?.createdAt)}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Pattern analysis will appear once enough trades have closed.</p>
              )
            }
          </GatedView>
        </Panel>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold">Recent signals</h2>
        {recent ? <SignalList items={recent.items} /> : <p className="text-sm text-muted-foreground">Signals are available to members.</p>}
      </section>
      <p className="mt-4 text-[11px] text-muted-foreground">
        Statistics {raw.calcVersion} · refreshed {fmtDateTime(meta?.computedAt ?? null)} · computed from deterministic outcomes only.
      </p>
    </>
  );
}
