import { ArrowLeft, Bot, Info, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AffiliateStrip } from "@/components/affiliate-strip";
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

function Section({ n, title, description, children, className }: { n: number; title: string; description?: string; children: React.ReactNode; className?: string }) {
  return (
    <Card className={cn("bg-card/60", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex size-5 items-center justify-center rounded bg-primary/10 text-[11px] text-primary">{n}</span>
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
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

export default async function SignalDetailPage({ params }: PageProps<"/signals/[id]">) {
  const { id } = await params;
  const viewer = await getViewer();
  const res = await getSignalDetailForViewer(id, viewer);
  if (res.kind === "not_found") notFound();
  if (res.kind !== "ok") {
    return (
      <>
        <Link href="/signals" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" /> Signals
        </Link>
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
    ...d.targets.map((t) => ({ price: t.price, label: `TP${t.index}`, tone: "target" as const })),
  ];
  const markers = [{ t: signalMs, label: "Published" }, ...(d.outcome.entryTime ? [{ t: Date.parse(d.outcome.entryTime), label: "Fill" }] : [])];
  const uid = viewer.user?.id;
  const session = sessionFor(new Date(d.signalTime));

  return (
    <>
      <Link href="/signals" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> Signals
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <DirectionBadge direction={d.direction} />
            <span>
              {d.instrument} {d.entryType.toLowerCase()} · {fmtEntry(d.entryMin, d.entryMax)}
            </span>
            <StatusBadge status={d.status} />
          </span>
        }
        description={`Published ${fmtDateTime(d.signalTime)} (${fmtAge(d.signalTime)} ago) · ${session} session`}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section n={1} title="Signal" description="As published by the source and normalized by the parser.">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label={d.entryType === "ZONE" ? "Entry zone" : "Entry"} value={<span className="font-mono text-base">{fmtEntry(d.entryMin, d.entryMax)}</span>} />
              <Stat label="Stop loss" value={<span className="font-mono text-base">{fmtPrice(d.stopLoss)}</span>} hint={d.stopLoss === null ? "not published" : undefined} />
              <Stat
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
            <div className="mt-4 rounded-lg border bg-background/40 p-2">
              <PriceChart points={points} levels={levels} markers={markers} />
            </div>
            <div className="mt-4">
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Original source text</div>
              <GatedView gated={d.rawText} title="Original source text" userId={uid} compact>
                {(text) =>
                  text ? (
                    <pre className="whitespace-pre-wrap break-words rounded-md border bg-background/60 p-3 font-mono text-xs leading-relaxed">{text}</pre>
                  ) : (
                    <p className="text-xs text-muted-foreground">This source does not permit redistribution of its original text.</p>
                  )
                }
              </GatedView>
            </div>
            {d.updates.length > 0 && (
              <div className="mt-4">
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">Source updates</div>
                <ul className="space-y-1.5">
                  {d.updates.map((u, i) => (
                    <li key={i} className="flex gap-3 text-xs">
                      <span className="w-32 shrink-0 text-muted-foreground">{fmtDateTime(u.publishedAt)}</span>
                      <Badge variant="outline" className="shrink-0">{u.eventType ?? "EVENT"}</Badge>
                      {u.text && <span className="truncate font-mono">{u.text}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Section>

          <Section n={3} title="Outcome" description={`Deterministic replay against 1-minute XAU/USD bars · ${d.outcome.calcVersion ?? "not yet calculated"}${d.outcome.kind === "override" ? " · manual override" : ""}`}>
            {d.outcome.ambiguous && (
              <div className="mb-3 flex gap-2 rounded-md border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-200">
                <Info className="size-4 shrink-0" />
                The stop and a target were both touched inside one 1-minute candle. The order cannot be determined from minute data, so no result is assigned.
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Entered" value={d.outcome.entered ? "Yes" : "No"} hint={d.outcome.entryTime ? fmtDateTime(d.outcome.entryTime) : undefined} />
              <Stat label="Fill price" value={<span className="font-mono text-base">{fmtPrice(d.outcome.entryPrice)}</span>} />
              <GatedView gated={d.outcome.basic} title="Result" userId={uid} compact>
                {(r) => <Stat label="Result" value={r ? <RValue value={r.rResult} /> : "Open"} hint={r ? `${r.classification.toLowerCase()} · ${r.exitReason?.toLowerCase() ?? ""}` : "shown after close"} />}
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
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">Trade timeline &amp; excursions</div>
                <GatedView gated={d.outcome.excursionDetail} title="Detailed MFE / MAE and timeline" userId={uid} compact>
                  {(x) =>
                    x ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="rounded border p-2">Best price <span className="float-right font-mono">{fmtPrice(x.bestPrice)}</span></div>
                          <div className="rounded border p-2">Worst price <span className="float-right font-mono">{fmtPrice(x.worstPrice)}</span></div>
                          <div className="rounded border p-2">MFE <span className="float-right font-mono">${fmtPrice(x.mfe)}</span></div>
                          <div className="rounded border p-2">MAE <span className="float-right font-mono">${fmtPrice(x.mae)}</span></div>
                          <div className="rounded border p-2">Risk (1R) <span className="float-right font-mono">{x.risk ? `$${fmtPrice(x.risk)}` : "—"}</span></div>
                          <div className="rounded border p-2">Duration <span className="float-right font-mono">{fmtMinutes(x.durationMinutes)}</span></div>
                        </div>
                        <ol className="space-y-1 border-l pl-3 text-xs">
                          {(x.timeline as { t: number; type: string; price?: number; note?: string }[]).map((e, i) => (
                            <li key={i} className="relative">
                              <span className="absolute -left-[15px] top-1.5 size-1.5 rounded-full bg-primary" />
                              <span className="text-muted-foreground">{fmtDateTime(new Date(e.t))}</span> · {TL_LABEL[e.type] ?? e.type}
                              {e.note ? ` (${e.note})` : ""} {e.price !== undefined && <span className="font-mono">@ {fmtPrice(e.price)}</span>}
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
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">Time to target</div>
                <GatedView gated={d.outcome.timeToTarget} title="Time-to-target" userId={uid} compact>
                  {(tt) =>
                    tt.length ? (
                      <div className="space-y-1.5 text-xs">
                        {tt.map((t) => (
                          <div key={t.index} className="flex items-center justify-between rounded border p-2">
                            <span>TP{t.index}</span>
                            <span className="font-mono">{t.ambiguous ? "ambiguous" : t.minutesFromEntry === null ? "not reached" : fmtMinutes(t.minutesFromEntry)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No targets were published.</p>
                    )
                  }
                </GatedView>
              </div>
            </div>
          </Section>

          <Section n={5} title="Similar trades" description="Earlier closed trades from this source matched on deterministic dimensions. Only trades that closed before this signal are used.">
            <GatedView gated={d.similar.summary} title="Similar historical trade summary" userId={uid}>
              {(s) =>
                s && s.matched > 0 ? (
                  <>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Stat label="Matched trades" value={s.matched} />
                      <Stat label="Win rate" value={fmtPct(s.winRate)} n={s.matched} />
                      <Stat label="Average R" value={<RValue value={s.avgR} />} n={s.matched} />
                      <Stat label="Won / lost" value={`${s.wins} / ${s.losses}`} />
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
                    <div className="overflow-x-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
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
                                <Link href={`/signals/${r.signalId}`} className="hover:text-primary">{fmtDateTime(r.signalTime)}</Link>
                              </TableCell>
                              <TableCell><StatusBadge status={r.classification} /></TableCell>
                              <TableCell className="text-right"><RValue value={r.rResult} /></TableCell>
                              <TableCell className="text-right font-mono text-xs">{r.mfeR?.toFixed(2) ?? "—"} / {r.maeR?.toFixed(2) ?? "—"}</TableCell>
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

          <Section n={6} title="AI analysis" description="Generated from the stored facts above. AI output never changes raw signals or deterministic results.">
            {d.ai.meta && (
              <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <Bot className="size-3.5" /> {d.ai.meta.model} · prompt {d.ai.meta.promptVersion} · {fmtDateTime(d.ai.meta.createdAt)}
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <GatedView gated={d.ai.classification} title="AI setup classification" userId={uid} compact>
                {(c) =>
                  c ? (
                    <div className="rounded-lg border bg-background/40 p-3">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Sparkles className="size-3.5 text-primary" /> Setup</div>
                      <div className="mt-1 text-lg font-semibold">{c.label}</div>
                      <div className="text-xs text-muted-foreground">confidence {fmtPct(c.confidence)}</div>
                      <p className="mt-2 text-sm">{c.rationale}</p>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Analysis is queued.</p>
                  )
                }
              </GatedView>
              <GatedView gated={d.ai.summary} title="AI context summary" userId={uid} compact>
                {(s) =>
                  s ? (
                    <div className="rounded-lg border bg-background/40 p-3">
                      <div className="text-xs text-muted-foreground">Context summary</div>
                      <p className="mt-1 text-sm leading-relaxed">{s.summary}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {s.marketContextTags.map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
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
                      <div className="flex flex-wrap gap-1">{p.patternTags.map((t) => <Badge key={t} variant="outline" className="border-primary/30 text-primary">{t}</Badge>)}</div>
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
          <Section n={2} title="How this source performed">
            {d.sourceStats && (
              <>
                <div className="mt-2 text-xs text-muted-foreground">{d.sourceStats.totalSignals} tracked signals · {d.sourceStats.closedTrades} closed</div>
                <div className="mt-3">
                  <GatedView gated={d.sourceStats.summary} title="Source statistics" userId={uid} compact>
                    {(s) => (
                      <div className="grid grid-cols-2 gap-2">
                        <Stat label="Win rate" value={fmtPct(s.winRate)} n={s.wins + s.losses + s.breakevens} />
                        <Stat label="Average R" value={<RValue value={s.avgR} />} n={s.ratedTrades} />
                        <Stat label="Expectancy" value={<RValue value={s.expectancy} />} n={s.ratedTrades} />
                        <Stat label="Avg duration" value={fmtMinutes(s.avgDurationMinutes)} />
                      </div>
                    )}
                  </GatedView>
                </div>
              </>
            )}
          </Section>

          <Section n={4} title="Historical context" description="How this source has performed in comparable conditions.">
            {d.sourceStats ? (
              <div className="space-y-4">
                <GatedView gated={d.sourceStats.direction} title="Performance by direction" userId={uid} compact>
                  {(b) => (
                    <div>
                      <div className="mb-2 text-xs text-muted-foreground">By direction</div>
                      <BucketRows buckets={b} />
                    </div>
                  )}
                </GatedView>
                <GatedView gated={d.sourceStats.recent} title="Recent performance" userId={uid} compact>
                  {(r) => (
                    <div className="grid grid-cols-2 gap-2">
                      <Stat label="Last 10 avg" value={<RValue value={r.recent10.avgR} />} n={r.recent10.n} hint={`${fmtPct(r.recent10.winRate)} win`} />
                      <Stat label="Last 30 avg" value={<RValue value={r.recent30.avgR} />} n={r.recent30.n} hint={`${fmtPct(r.recent30.winRate)} win`} />
                    </div>
                  )}
                </GatedView>
                <GatedView gated={d.sourceStats.extended} title="Session breakdown" userId={uid} compact>
                  {(x) => (
                    <div>
                      <div className="mb-2 text-xs text-muted-foreground">By session (UTC) · this signal: {session}</div>
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
