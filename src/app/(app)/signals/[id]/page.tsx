import { ArrowLeft, Bot, BrainCircuit, Crosshair, GitCompare, History, Info, Sparkles, Target, Trophy, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AffiliateStrip } from "@/components/affiliate-strip";
import { ConsensusPanel } from "@/components/consensus-panel";
import { BucketRows } from "@/components/bucket-chart";
import { GatedView, LockedPanel } from "@/components/locked";
import { PageHeader } from "@/components/page-header";
import { downsample, PriceChart } from "@/components/price-chart";
import { DirectionBadge, RValue, Stat, StatusBadge } from "@/components/signal-bits";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtAge, fmtDateTime, fmtEntry, fmtMinutes, fmtPct, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/server/analytics";
import { sessionFor } from "@/server/statistics/compute";
import { getViewer } from "@/server/entitlements/service";
import { getEngineBars } from "@/server/market-data";
import { getSignalDetailForViewer } from "@/server/signals/queries";
import { nowMs } from "@/lib/clock";

export const metadata: Metadata = { title: "Signal" };

type Icon = React.ComponentType<{ className?: string }>;

const BOX = "rounded-xl bg-black/25 p-3.5 ring-1 ring-glow/20";

function Section({ icon: IconCmp, title, description, children, className }: { icon: Icon; title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={className}>
      <CardHeader className="border-b border-glow/15">
        <CardTitle className="flex items-center gap-2.5 text-base">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/50">
            <IconCmp className="size-4" />
          </span>
          {title}
        </CardTitle>
        {description && <CardDescription className="text-xs leading-relaxed">{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function SubLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mb-2 text-xs font-semibold text-[#8db6ff]", className)}>{children}</div>;
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg bg-black/25 px-2.5 py-2 ring-1 ring-glow/20">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{children}</span>
    </div>
  );
}

const TL_LABEL: Record<string, string> = {
  ENTRY: "Entry filled",
  TARGET: "Target reached",
  STOP: "Stop hit",
  MOVE_STOP: "Stop moved",
  CLOSE: "Closed by source",
  CANCEL: "Cancelled",
  EXPIRE: "Expired unfilled",
  TIMEOUT: "Max hold reached",
  AMBIGUOUS: "Ambiguous candle",
};

const TL_DOT: Record<string, string> = {
  ENTRY: "bg-primary shadow-[0_0_8px_var(--primary)]",
  TARGET: "bg-win shadow-[0_0_8px_var(--win)]",
  STOP: "bg-loss shadow-[0_0_8px_var(--loss)]",
  AMBIGUOUS: "bg-amber-300",
};

function rTone(r: number | null | undefined) {
  if (r === null || r === undefined) return "blue" as const;
  return r > 0.05 ? ("win" as const) : r < -0.05 ? ("loss" as const) : ("blue" as const);
}

export default async function SignalDetailPage({ params }: PageProps<"/signals/[id]">) {
  const { id } = await params;
  const viewer = await getViewer();
  const res = await getSignalDetailForViewer(id, viewer);
  if (res.kind === "not_found") notFound();
  const back = (
    <Link
      href="/signals"
      className="mb-3 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="size-4" /> Live signals
    </Link>
  );
  if (res.kind !== "ok") {
    return (
      <>
        {back}
        <LockedPanel
          feature={res.kind === "history_locked" ? "sources.history.full" : "signals.core"}
          requiredTier={res.requiredTier}
          title={res.kind === "history_locked" ? "This signal is older than your plan’s history window" : "Signals are available to members"}
          userId={viewer.user?.id}
        />
      </>
    );
  }
  const d = res.detail;
  void trackEvent("signal_viewed", viewer.user?.id ?? null, { signalId: d.id, source: d.source.slug });

  const signalMs = Date.parse(d.signalTime);
  const endMs = Math.min(nowMs(), (d.closedAt ? Date.parse(d.closedAt) : nowMs()) + 90 * 60_000, signalMs + 3 * 86_400_000);
  const bars = await getEngineBars(new Date(signalMs - 120 * 60_000), new Date(endMs));
  const points = downsample(bars);
  const levels = [
    { price: d.entryMin, label: d.entryMin === d.entryMax ? "Entry" : "Zone", tone: "entry" as const },
    ...(d.entryMin !== d.entryMax ? [{ price: d.entryMax, label: "Zone", tone: "entry" as const }] : []),
    ...(d.stopLoss !== null ? [{ price: d.stopLoss, label: "SL", tone: "stop" as const }] : []),
    ...d.targets.flatMap((t) => (t.price === null ? [] : [{ price: t.price, label: `TP${t.index}`, tone: "target" as const }])),
  ];
  const markers = [{ t: signalMs, label: "Published" }, ...(d.outcome.entryTime ? [{ t: Date.parse(d.outcome.entryTime), label: "Fill" }] : [])];
  const uid = viewer.user?.id;
  const session = sessionFor(new Date(d.signalTime));

  return (
    <>
      {back}
      <PageHeader
        size="sm"
        icon={Crosshair}
        title={
          <>
            {d.instrument} {d.entryType.toLowerCase()} · <span className="tabular-nums">{fmtEntry(d.entryMin, d.entryMax)}</span>
          </>
        }
      >
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <DirectionBadge direction={d.direction} />
          <StatusBadge status={d.status} />
          <span className="text-sm text-foreground/80">{`Published ${fmtDateTime(d.signalTime)} (${fmtAge(d.signalTime)} ago) · ${session} session`}</span>
        </div>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section icon={Crosshair} title="Signal" description="As published by the source and normalized by the parser.">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat tone="gold" label={d.entryType === "ZONE" ? "Entry zone" : "Entry"} value={<span className="font-mono text-base">{fmtEntry(d.entryMin, d.entryMax)}</span>} />
              <Stat tone="loss" label="Stop loss" value={<span className={cn("font-mono text-base", d.stopLoss !== null && "text-loss")}>{fmtPrice(d.stopLoss)}</span>} />
              <Stat
                tone="win"
                label="Targets"
                value={
                  <span className="flex flex-col font-mono text-sm">
                    {d.targets.length ? d.targets.map((t) => (
                      <span key={t.index} className={cn(t.status === "HIT" && "text-win", t.status === "AMBIGUOUS" && "text-amber-300")}>
                        TP{t.index} {fmtPrice(t.price)}
                      </span>
                    )) : "—"}
                  </span>
                }
              />
              <Stat label="Parser confidence" value={fmtPct(d.parserConfidence)} hint={`version ${d.version}${d.sourceConfidenceText ? ` · source says “${d.sourceConfidenceText}”` : ""}`} />
            </div>
            <div className="mt-4 rounded-xl bg-[#050c1c]/80 p-2 ring-1 ring-glow/25 shadow-[inset_0_0_30px_-12px_rgb(47_123_255/0.4)]">
              <PriceChart points={points} levels={levels} markers={markers} />
            </div>
            <div className="mt-4">
              <SubLabel>Original source text</SubLabel>
              <GatedView gated={d.rawText} title="Original source text" userId={uid} compact>
                {(text) =>
                  text ? (
                    <pre className="whitespace-pre-wrap break-words rounded-xl border-l-2 border-primary/60 bg-black/35 p-3.5 font-mono text-xs leading-relaxed ring-1 ring-glow/20">{text}</pre>
                  ) : (
                    <p className="text-xs text-muted-foreground">This source does not permit redistribution of its original text.</p>
                  )
                }
              </GatedView>
            </div>
            {d.updates.length > 0 && (
              <div className="mt-4">
                <SubLabel>Source updates</SubLabel>
                <ul className="divide-y divide-glow/10 rounded-xl bg-black/20 px-3 ring-1 ring-glow/15">
                  {d.updates.map((u, i) => (
                    <li key={i} className="flex items-center gap-3 py-2 text-xs">
                      <span className="w-32 shrink-0 text-muted-foreground">{fmtDateTime(u.publishedAt)}</span>
                      <Badge variant="outline" className="shrink-0 rounded-md border-glow/40 text-[#8db6ff]">{u.eventType ?? "EVENT"}</Badge>
                      {u.text && <span className="truncate font-mono">{u.text}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          <Section icon={Users} title="Cross-trader consensus" description="Sources on this same entry zone inside 30 minutes. Channel names are not shown.">
            <ConsensusPanel grade={d.consensus.grade} timing={d.consensus.timing} mapping={d.consensus.mapping} userId={uid} />
          </Section>

          <Section icon={Target} title="Outcome" description={`Deterministic replay against 1-minute XAU/USD bars · ${d.outcome.calcVersion ?? "not yet calculated"}${d.outcome.kind === "override" ? " · manual override" : ""}`}>
            {d.outcome.ambiguous && (
              <div className="mb-3 flex gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-200">
                <Info className="size-4 shrink-0" />
                The stop and a target were both touched inside one 1-minute candle. The order cannot be determined from minute data, so no result is assigned.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Entered" value={d.outcome.entered ? "Yes" : "No"} hint={d.outcome.entryTime ? fmtDateTime(d.outcome.entryTime) : undefined} />
              <Stat tone="gold" label="Fill price" value={<span className="font-mono text-base">{fmtPrice(d.outcome.entryPrice)}</span>} />
              <GatedView gated={d.outcome.basic} title="Result" userId={uid} compact>
                {(r) => (
                  <Stat
                    tone={rTone(r?.rResult)}
                    label="Result"
                    value={r ? <RValue value={r.rResult} /> : "Open"}
                    hint={r ? `${r.classification.toLowerCase()} · ${r.exitReason?.toLowerCase() ?? ""}` : "shown after close"}
                  />
                )}
              </GatedView>
              <GatedView gated={d.outcome.excursionSummary} title="MFE / MAE" userId={uid} compact>
                {(x) => <Stat label="MFE / MAE" value={x ? <span className="text-base"><RValue value={x.mfeR} /> / <RValue value={x.maeR === null ? null : -x.maeR} /></span> : "—"} hint="in R, after entry" />}
              </GatedView>
            </div>
            {d.outcome.notes.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {d.outcome.notes.map((n) => (
                  <li key={n}>• {n}</li>
                ))}
              </ul>
            )}
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <SubLabel>Trade timeline &amp; excursions</SubLabel>
                <GatedView gated={d.outcome.excursionDetail} title="Detailed MFE / MAE and timeline" userId={uid} compact>
                  {(x) =>
                    x ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <Cell label="Best price">{fmtPrice(x.bestPrice)}</Cell>
                          <Cell label="Worst price">{fmtPrice(x.worstPrice)}</Cell>
                          <Cell label="MFE">${fmtPrice(x.mfe)}</Cell>
                          <Cell label="MAE">${fmtPrice(x.mae)}</Cell>
                          <Cell label="Risk (1R)">{x.risk ? `$${fmtPrice(x.risk)}` : "—"}</Cell>
                          <Cell label="Duration">{fmtMinutes(x.durationMinutes)}</Cell>
                        </div>
                        <ol className="ml-1 space-y-2.5 border-l border-glow/35 pl-4 text-xs">
                          {(x.timeline as { t: number; type: string; price?: number; note?: string }[]).map((e, i) => (
                            <li key={i} className="relative">
                              <span className={cn("absolute -left-[21.5px] top-1 size-2.5 rounded-full ring-2 ring-[#081328]", TL_DOT[e.type] ?? "bg-[#8db6ff]")} />
                              <div className="font-medium">
                                {TL_LABEL[e.type] ?? e.type}
                                {e.note ? ` (${e.note})` : ""} {e.price !== undefined && <span className="font-mono text-foreground/80">@ {fmtPrice(e.price)}</span>}
                              </div>
                              <div className="text-[11px] text-muted-foreground">{fmtDateTime(new Date(e.t))}</div>
                            </li>
                          ))}
                        </ol>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Not entered.</p>
                    )
                  }
                </GatedView>
              </div>
              <div>
                <SubLabel>Time to target</SubLabel>
                <GatedView gated={d.outcome.timeToTarget} title="Time-to-target" userId={uid} compact>
                  {(tt) =>
                    tt.length ? (
                      <div className="space-y-2 text-xs">
                        {tt.map((t) => (
                          <div key={t.index} className="flex items-center justify-between rounded-lg bg-black/25 px-2.5 py-2 ring-1 ring-glow/20">
                            <span className="font-semibold">TP{t.index}</span>
                            <span
                              className={cn(
                                "font-mono",
                                t.ambiguous ? "text-amber-300" : t.minutesFromEntry === null ? "text-muted-foreground" : "text-win",
                              )}
                            >
                              {t.ambiguous ? "ambiguous" : t.minutesFromEntry === null ? "not reached" : fmtMinutes(t.minutesFromEntry)}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">—</p>
                    )
                  }
                </GatedView>
              </div>
            </div>
          </Section>

          <Section icon={GitCompare} title="Similar trades" description="Earlier closed trades from this source matched on deterministic dimensions. Only trades that closed before this signal are used.">
            <GatedView gated={d.similar.summary} title="Similar historical trade summary" userId={uid}>
              {(s) =>
                s && s.matched > 0 ? (
                  <>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Stat label="Matched trades" value={s.matched} />
                      <Stat tone="gold" label="Win rate" value={fmtPct(s.winRate)} n={s.matched} />
                      <Stat tone={rTone(s.avgR)} label="Average R" value={<RValue value={s.avgR} />} n={s.matched} />
                      <Stat label="Won / lost" value={<><span className="text-win">{s.wins}</span> / <span className="text-loss">{s.losses}</span></>} />
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">Matched on: {s.dimensions.join(", ")}.</p>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No earlier closed trades match this setup yet.</p>
                )
              }
            </GatedView>
            <div className="mt-4">
              <GatedView gated={d.similar.details} title="Similar-trade details" userId={uid} compact>
                {(rows) =>
                  rows.length ? (
                    <div className="overflow-x-auto rounded-xl bg-black/20 ring-1 ring-glow/20">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead>Published</TableHead>
                            <TableHead>Result</TableHead>
                            <TableHead className="text-right">R</TableHead>
                            <TableHead className="text-right">MFE / MAE</TableHead>
                            <TableHead className="text-right">Duration</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {rows.map((r) => (
                            <TableRow key={r.signalId}>
                              <TableCell>
                                <Link href={`/signals/${r.signalId}`} className="rounded font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">{fmtDateTime(r.signalTime)}</Link>
                              </TableCell>
                              <TableCell><StatusBadge status={r.classification} /></TableCell>
                              <TableCell className="text-right"><RValue value={r.rResult} className="font-semibold" /></TableCell>
                              <TableCell className="text-right font-mono text-xs tabular-nums">{r.mfeR?.toFixed(2) ?? "—"} / {r.maeR?.toFixed(2) ?? "—"}</TableCell>
                              <TableCell className="text-right text-xs">{fmtMinutes(r.durationMinutes)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : null
                }
              </GatedView>
            </div>
          </Section>

          <Section icon={BrainCircuit} title="AI analysis" description="Generated from the stored facts above. AI output never changes raw signals or deterministic results.">
            {d.ai.meta && (
              <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <Bot className="size-3.5 text-[#8db6ff]" /> {d.ai.meta.model} · prompt {d.ai.meta.promptVersion} · {fmtDateTime(d.ai.meta.createdAt)}
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <GatedView gated={d.ai.classification} title="AI setup classification" userId={uid} compact>
                {(c) =>
                  c ? (
                    <div className={BOX}>
                      <div className="flex items-center gap-2 text-xs font-semibold text-[#8db6ff]"><Sparkles className="size-3.5 text-primary" /> Setup</div>
                      <div className="gold-text mt-1 font-heading text-lg font-bold tracking-tight">{c.label}</div>
                      <div className="text-xs text-muted-foreground">confidence {fmtPct(c.confidence)}</div>
                      <p className="mt-2 text-sm leading-relaxed">{c.rationale}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Analysis is queued.</p>
                  )
                }
              </GatedView>
              <GatedView gated={d.ai.summary} title="AI context summary" userId={uid} compact>
                {(s) =>
                  s ? (
                    <div className={BOX}>
                      <div className="text-xs font-semibold text-[#8db6ff]">Context summary</div>
                      <p className="mt-1 text-sm leading-relaxed">{s.summary}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {s.marketContextTags.map((t) => <Badge key={t} variant="outline" className="rounded-md border-glow/40 bg-glow/10 text-[#8db6ff]">{t}</Badge>)}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Analysis is queued.</p>
                  )
                }
              </GatedView>
            </div>
            <div className="mt-4">
              <GatedView gated={d.ai.patterns} title="AI pattern analysis" userId={uid} compact>
                {(p) =>
                  p ? (
                    <div className="space-y-2 text-sm">
                      <div className="flex flex-wrap gap-1">{p.patternTags.map((t) => <Badge key={t} variant="outline" className="rounded-md border-primary/40 bg-primary/10 text-primary">{t}</Badge>)}</div>
                      {p.similarPatternExplanation && <p className="text-muted-foreground">{p.similarPatternExplanation}</p>}
                      {(p.sourceStrengths.length > 0 || p.sourceWeaknesses.length > 0) && (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <ul className="space-y-1 text-xs">{p.sourceStrengths.map((s) => <li key={s} className="text-win">+ {s}</li>)}</ul>
                          <ul className="space-y-1 text-xs">{p.sourceWeaknesses.map((s) => <li key={s} className="text-loss">− {s}</li>)}</ul>
                        </div>
                      )}
                    </div>
                  ) : null
                }
              </GatedView>
            </div>
          </Section>
        </div>

        <div className="space-y-4">
          <Section icon={Trophy} title="How this source performed" className="panel-gold shadow-[0_0_28px_-8px_rgb(245_197_66/0.55)] ring-primary/55">
            {d.sourceStats && (
              <>
                <div className="text-xs text-muted-foreground">
                  <span className="font-mono text-foreground/90">{d.sourceStats.totalSignals}</span> tracked signals ·{" "}
                  <span className="font-mono text-foreground/90">{d.sourceStats.closedTrades}</span> closed
                </div>
                <div className="mt-3">
                  <GatedView gated={d.sourceStats.summary} title="Source statistics" userId={uid} compact>
                    {(s) => (
                      <div className="grid grid-cols-2 gap-2">
                        <Stat tone="gold" label="Win rate" value={fmtPct(s.winRate)} n={s.wins + s.losses + s.breakevens} />
                        <Stat tone={rTone(s.avgR)} label="Average R" value={<RValue value={s.avgR} />} n={s.ratedTrades} />
                        <Stat tone={rTone(s.expectancy)} label="Expectancy" value={<RValue value={s.expectancy} />} n={s.ratedTrades} />
                        <Stat label="Avg duration" value={fmtMinutes(s.avgDurationMinutes)} />
                      </div>
                    )}
                  </GatedView>
                </div>
              </>
            )}
          </Section>

          <Section icon={History} title="Historical context" description="How this source has performed in comparable conditions.">
            {d.sourceStats ? (
              <div className="space-y-5">
                <GatedView gated={d.sourceStats.direction} title="Performance by direction" userId={uid} compact>
                  {(b) => (
                    <div>
                      <SubLabel>By direction</SubLabel>
                      <BucketRows buckets={b} />
                    </div>
                  )}
                </GatedView>
                <GatedView gated={d.sourceStats.recent} title="Recent performance" userId={uid} compact>
                  {(r) => (
                    <div className="grid grid-cols-2 gap-2">
                      <Stat tone={rTone(r.recent10.avgR)} label="Last 10 avg" value={<RValue value={r.recent10.avgR} />} n={r.recent10.n} hint={`${fmtPct(r.recent10.winRate)} win`} />
                      <Stat tone={rTone(r.recent30.avgR)} label="Last 30 avg" value={<RValue value={r.recent30.avgR} />} n={r.recent30.n} hint={`${fmtPct(r.recent30.winRate)} win`} />
                    </div>
                  )}
                </GatedView>
                <GatedView gated={d.sourceStats.extended} title="Session breakdown" userId={uid} compact>
                  {(x) => (
                    <div>
                      <SubLabel>By session (UTC) · this signal: {session}</SubLabel>
                      <BucketRows buckets={x.bySession} />
                    </div>
                  )}
                </GatedView>
              </div>
            ) : (
              <LockedPanel feature="sources.stats.summary" requiredTier="gold" title="Historical context" userId={uid} compact />
            )}
          </Section>
          <AffiliateStrip placement="signal_detail" />
        </div>
      </div>
    </>
  );
}
