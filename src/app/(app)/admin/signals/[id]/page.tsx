import { Bot, Eye, FileClock, History, Inbox, ListChecks, MessageSquareText, PenLine, ShieldAlert, Target, UsersRound } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { clearOverrideAction, correctSignalAction, overrideOutcomeAction, recalcOutcomeAction, rerunAiAction } from "@/app/actions/admin";
import { Field, JsonBlock, NativeSelect, Notice } from "@/components/admin-bits";
import { LiveRefresh } from "@/components/live-refresh";
import { PageHeader, SectionTitle } from "@/components/page-header";
import { DirectionBadge, RValue, StatusBadge } from "@/components/signal-bits";
import { SignalFieldsForm } from "@/components/signal-fields-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fmtDateTime, fmtEntry, fmtPrice } from "@/lib/format";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAdminSignalDetail } from "@/server/admin";
import { DEFAULT_PROMPT, promptsFor } from "@/server/ai/prompts";
import { requireAdmin } from "@/server/auth/guards";

export const metadata = { title: "Signal" };

export default async function AdminSignalPage({ params, searchParams }: PageProps<"/admin/signals/[id]">) {
  await requireAdmin();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const d = await getAdminSignalDetail(id);
  if (!d) notFound();
  const { signal, source, targets, outcome } = d;
  const isOverride = outcome?.kind === "override";

  const open = signal.status === "PENDING" || signal.status === "ACTIVE" || signal.status === "PARTIAL";
  return (
    <>
      {open && <LiveRefresh />}
      <PageHeader
        icon={ListChecks}
        size="sm"
        title={
          <span className="flex flex-wrap items-center gap-3">
            {source.name} <DirectionBadge direction={signal.direction} /> <StatusBadge status={signal.status} />
          </span>
        }
        description={`Members see “${source.nickname}” · ${fmtDateTime(signal.signalTime)} · version ${signal.version} · parser confidence ${(signal.parserConfidence * 100).toFixed(0)}%`}
        actions={
          <>
            <Link href={`/signals/${signal.id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
              <Eye data-icon="inline-start" />
              Member view
            </Link>
            <Link href={`/admin/events/${signal.originEventId}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <Inbox data-icon="inline-start" />
              Origin event
            </Link>
          </>
        }
      />
      <Notice searchParams={sp} />

      {d.consensus && (
        <Card className="panel-gold mb-4 ring-primary/55 shadow-[0_0_28px_-8px_rgb(245_197_66/0.55)]">
          <CardHeader>
            <SectionTitle icon={UsersRound} title="Cross-trader consensus" className="mb-0" />
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="gold-text font-heading text-xl font-extrabold tracking-tight">{d.consensus.grade.label}</div>
            {d.consensus.grade.riskNote && <p className="text-amber-200">{d.consensus.grade.riskNote}</p>}
            <p className="text-muted-foreground">{d.consensus.mapping.sentence}</p>
            {d.consensus.mapping.oppositionSentence && <p className="text-muted-foreground">{d.consensus.mapping.oppositionSentence}</p>}
            <div className="overflow-x-auto rounded-lg border border-glow/25 bg-black/20">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Direction</TableHead>
                    <TableHead>Zone</TableHead>
                    <TableHead>Offset</TableHead>
                    <TableHead>Record</TableHead>
                    <TableHead>Role</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.consensus.participants.map((row) => (
                    <TableRow key={row.signalId}>
                      <TableCell>
                        <div className="font-medium">{row.sourceName}</div>
                        <div className="font-mono text-[11px] text-muted-foreground">
                          {row.slug}
                          {row.telegramUsername ? ` · @${row.telegramUsername}` : ""}
                        </div>
                      </TableCell>
                      <TableCell>
                        <DirectionBadge direction={row.direction} />
                      </TableCell>
                      <TableCell className="font-mono tabular-nums">{fmtEntry(row.entryMin, row.entryMax)}</TableCell>
                      <TableCell className="font-mono tabular-nums">{row.offsetMinutes === 0 ? "this signal" : `${row.offsetMinutes > 0 ? "+" : ""}${row.offsetMinutes} min`}</TableCell>
                      <TableCell className="text-xs">
                        {row.historicallyAccurate ? "Historically accurate" : "Not rated accurate"}
                        {row.topPerformerRank ? ` · rank ${row.topPerformerRank}` : ""}
                      </TableCell>
                      <TableCell className="text-xs">{row.role}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-xs text-muted-foreground">Member pages never receive these names. This list follows the same cluster the score uses.</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <SectionTitle icon={PenLine} title="Correct signal" className="mb-0" />
          </CardHeader>
          <CardContent>
            <form action={correctSignalAction} className="space-y-3">
              <input type="hidden" name="signalId" value={signal.id} />
              <SignalFieldsForm
                idPrefix="correct"
                d={{
                  direction: signal.direction,
                  entryType: signal.entryType,
                  entryMin: signal.entryMin,
                  entryMax: signal.entryMax,
                  stopLoss: signal.stopLoss,
                  targets: targets.flatMap((t) => (t.price === null ? [] : [t.price])),
                  signalType: signal.signalType,
                  sourceConfidenceText: signal.sourceConfidenceText,
                  signalTime: signal.signalTime,
                }}
              />
              <div className="grid gap-3 sm:grid-cols-[1fr_12rem_auto] sm:items-end">
                <Field label="Reason (required)" htmlFor="correct-reason">
                  <Input id="correct-reason" name="reason" required minLength={3} placeholder="e.g. Source edited the stop in a follow-up post" />
                </Field>
                <Field label="Mark as" htmlFor="correct-status">
                  <NativeSelect id="correct-status" name="status" defaultValue="">
                    <option value="">Keep status (recompute)</option>
                    <option value="INVALID">Invalid (hide from members)</option>
                  </NativeSelect>
                </Field>
                <Button type="submit">Save correction</Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle icon={Target} title="Current outcome" className="mb-0" />
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {outcome ? (
              <dl className="grid grid-cols-2 gap-y-2">
                <dt className="text-muted-foreground">Classification</dt>
                <dd>
                  <StatusBadge status={outcome.classification} /> {isOverride && <span className="text-xs font-medium text-amber-300">override</span>}
                </dd>
                <dt className="text-muted-foreground">R result</dt>
                <dd>
                  <RValue value={outcome.rResult} />
                </dd>
                <dt className="text-muted-foreground">Entry</dt>
                <dd className="font-mono tabular-nums">
                  {fmtPrice(outcome.entryPrice)} {outcome.entryTime && <span className="font-sans text-xs text-muted-foreground">{fmtDateTime(outcome.entryTime)}</span>}
                </dd>
                <dt className="text-muted-foreground">Exit</dt>
                <dd className="text-xs">
                  {outcome.exitReason ?? "—"} {fmtDateTime(outcome.exitTime)}
                </dd>
                <dt className="text-muted-foreground">Rules</dt>
                <dd className="font-mono text-xs">{outcome.calcVersion}</dd>
              </dl>
            ) : (
              <p className="text-muted-foreground">No outcome computed yet.</p>
            )}
            <form action={recalcOutcomeAction} className="flex items-center gap-2 border-t pt-3">
              <input type="hidden" name="signalId" value={signal.id} />
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" name="force" className="accent-primary" /> Replace override
              </label>
              <Button type="submit" size="sm" variant="outline" className="ml-auto">
                Recalculate
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle icon={ShieldAlert} title="Override outcome" className="mb-0" />
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-muted-foreground">For exceptional cases only, such as ambiguous candles resolved from tick data. The computed history is kept.</p>
            <form action={overrideOutcomeAction} className="grid grid-cols-2 gap-3">
              <input type="hidden" name="signalId" value={signal.id} />
              <Field label="Classification" htmlFor="ov-class">
                <NativeSelect id="ov-class" name="classification" required defaultValue="">
                  <option value="" disabled>
                    Choose
                  </option>
                  {["WON", "LOST", "BREAKEVEN", "CANCELLED", "EXPIRED"].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="R result" htmlFor="ov-r">
                <Input id="ov-r" name="rResult" inputMode="decimal" className="font-mono tabular-nums" />
              </Field>
              <Field label="Exit time (UTC)" htmlFor="ov-exit" className="col-span-2">
                <Input id="ov-exit" name="exitTime" type="datetime-local" />
              </Field>
              <Field label="Reason (required)" htmlFor="ov-reason" className="col-span-2">
                <Input id="ov-reason" name="reason" required minLength={3} />
              </Field>
              <Button type="submit" variant="outline" className="col-span-2">
                Apply override
              </Button>
            </form>
            {isOverride && (
              <form action={clearOverrideAction} className="mt-4 flex gap-2 border-t pt-3">
                <input type="hidden" name="signalId" value={signal.id} />
                <Input name="reason" required minLength={3} placeholder="Reason for clearing" />
                <Button type="submit" variant="ghost">
                  Clear
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle icon={Bot} title="AI analysis" className="mb-0" />
          </CardHeader>
          <CardContent className="space-y-3">
            <form action={rerunAiAction} className="flex gap-2">
              <input type="hidden" name="signalId" value={signal.id} />
              <NativeSelect name="promptVersion" defaultValue={DEFAULT_PROMPT.signal_setup} aria-label="Prompt version" className="h-8 font-mono text-xs">
                {promptsFor("signal_setup").map((p) => (
                  <option key={p.version} value={p.version}>
                    {p.version}
                  </option>
                ))}
              </NativeSelect>
              <Button type="submit" size="sm" variant="outline">
                Regenerate
              </Button>
            </form>
            {d.analyses.length === 0 && <p className="text-sm text-muted-foreground">No analysis yet.</p>}
            {d.analyses.map((a) => (
              <details key={a.id} open={a.isCurrent} className="rounded-lg border border-glow/25 bg-black/15 p-2.5 open:border-glow/40">
                <summary className="cursor-pointer text-xs font-medium">
                  {a.promptVersion} · {a.model} · {fmtDateTime(a.createdAt)} {a.isCurrent && <span className="ml-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">current</span>}
                </summary>
                <JsonBlock value={a.outputJson} className="mt-2" />
              </details>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle icon={MessageSquareText} title="Source instructions" className="mb-0" />
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-lg border border-glow/20 bg-[#050b18] p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap">{d.origin?.rawText}</div>
            <div className="font-mono text-xs text-muted-foreground tabular-nums">
              Entry {fmtEntry(signal.entryMin, signal.entryMax)} · SL {fmtPrice(signal.stopLoss)} · TP {targets.map((t) => fmtPrice(t.price)).join(" / ") || "—"}
            </div>
            {d.adjustments.length === 0 ? (
              <p className="text-xs text-muted-foreground">No follow-up adjustments.</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {d.adjustments.map((a) => (
                  <li key={a.id} className="flex justify-between gap-2">
                    <span className="font-medium">{a.type}</span>
                    <span className="font-mono text-muted-foreground">{JSON.stringify(a.payloadJson)}</span>
                    <span className="text-muted-foreground">{fmtDateTime(a.effectiveAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader>
            <SectionTitle icon={History} title="Outcome history" className="mb-0" />
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border text-sm">
              {d.outcomes.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                  <StatusBadge status={o.classification} />
                  <RValue value={o.rResult} />
                  <span className="text-xs text-muted-foreground">
                    {o.kind} · {o.calcVersion} · signal v{o.signalVersion} · {fmtDateTime(o.computedAt)}
                  </span>
                  {o.isCurrent && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">current</span>}
                  {o.overrideReason && <span className="w-full text-xs text-amber-300/90">Reason: {o.overrideReason}</span>}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <SectionTitle icon={FileClock} title="Audit trail" className="mb-0" />
          </CardHeader>
          <CardContent>
            {d.audit.length === 0 ? (
              <p className="text-sm text-muted-foreground">No manual changes.</p>
            ) : (
              <ul className="space-y-3 text-xs">
                {d.audit.map((a) => (
                  <li key={a.id}>
                    <div className="flex justify-between gap-2">
                      <span className="font-mono font-semibold text-primary">{a.action}</span>
                      <span className="text-muted-foreground">{fmtDateTime(a.createdAt)}</span>
                    </div>
                    <div className="text-muted-foreground">
                      {a.actorLabel}
                      {a.reason ? ` · ${a.reason}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
