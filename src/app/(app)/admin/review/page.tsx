import { CheckCircle2, ClipboardCheck, ExternalLink, Plus, X } from "lucide-react";
import Link from "next/link";
import { dismissReviewAction, resolveReviewAction } from "@/app/actions/admin";
import { EmptyState, Field, Notice, StateBadge } from "@/components/admin-bits";
import { PageHeader } from "@/components/page-header";
import { SignalFieldsForm } from "@/components/signal-fields-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fmtDateTime } from "@/lib/format";
import { listReviewQueue } from "@/server/admin";
import { requireAdmin } from "@/server/auth/guards";
import type { ParseOutput } from "@/server/parsing";

export const metadata = { title: "Review queue" };

export default async function ReviewPage({ searchParams }: PageProps<"/admin/review">) {
  await requireAdmin();
  const sp = await searchParams;
  const items = await listReviewQueue();

  return (
    <>
      <PageHeader
        icon={ClipboardCheck}
        size="sm"
        title="Review queue"
        description="The model reviews these posts first. A post stays here when the model is unsure or its confidence is under 80%. Create the signal with corrected fields, or dismiss the message. Every decision is audited."
        actions={
          items.length > 0 && (
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary ring-1 ring-primary/45">
              <span className="font-mono tabular-nums">{items.length}</span> waiting
            </span>
          )
        }
      />
      <Notice searchParams={sp} />
      {items.length === 0 ? (
        <EmptyState icon={CheckCircle2}>The queue is empty. Posts the model cannot decide are listed here.</EmptyState>
      ) : (
        <div className="space-y-4">
          {items.map(({ event, source, parse }) => {
            const out = parse.outputJson as unknown as ParseOutput;
            const s = out.signal;
            const isSignal = parse.eventType === "NEW_SIGNAL";
            return (
              <Card key={parse.id}>
                <CardHeader className="border-b">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-heading text-base font-bold">{source.name}</span>
                    <span className="font-sans font-normal text-muted-foreground tabular-nums">{fmtDateTime(event.publishedAt)}</span>
                    <StateBadge state={parse.status} />
                    <span className="rounded-full border border-glow/40 bg-glow/10 px-2 py-0.5 font-mono text-[11px] font-medium text-[#8db6ff]">{parse.eventType}</span>
                    <span className="font-sans text-xs font-normal text-muted-foreground">
                      confidence <span className="font-mono font-semibold text-foreground tabular-nums">{(parse.confidence * 100).toFixed(0)}%</span>
                    </span>
                    <Link href={`/admin/events/${event.id}`} className="ml-auto inline-flex items-center gap-1 font-sans text-xs font-medium text-[#8db6ff] hover:text-primary">
                      Event detail
                      <ExternalLink className="size-3.5" />
                    </Link>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <pre className="whitespace-pre-wrap rounded-lg border border-glow/20 bg-[#050b18] p-3 font-mono text-xs leading-relaxed">{event.rawText}</pre>
                  {parse.issues.length > 0 && (
                    <ul className="list-inside list-disc text-xs text-amber-300/90">
                      {parse.issues.map((i) => (
                        <li key={i}>{i}</li>
                      ))}
                    </ul>
                  )}
                  {isSignal && (
                    <form action={resolveReviewAction} className="space-y-3 rounded-xl border border-primary/35 bg-primary/[0.04] p-3.5">
                      <div className="flex items-center gap-1.5 font-heading text-sm font-bold text-primary">
                        <Plus className="size-4" />
                        Create signal
                      </div>
                      <input type="hidden" name="rawEventId" value={event.id} />
                      <input type="hidden" name="publishedAt" value={event.publishedAt.toISOString()} />
                      <SignalFieldsForm
                        idPrefix={parse.id}
                        d={{
                          direction: s?.direction.value,
                          entryType: s?.entryType.value,
                          entryMin: s?.entryMin.value,
                          entryMax: s?.entryMax.value,
                          stopLoss: s?.stopLoss.value,
                          targets: s?.targets.value?.filter((price): price is number => price !== null),
                          signalType: s?.signalType.value,
                          sourceConfidenceText: s?.sourceConfidenceText.value,
                          signalTime: event.publishedAt,
                        }}
                      />
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                        <Field label="Reason" htmlFor={`${parse.id}-reason`} className="flex-1">
                          <Input id={`${parse.id}-reason`} name="reason" required minLength={3} placeholder="e.g. Entry confirmed from source chart" />
                        </Field>
                        <Button type="submit">Create signal</Button>
                      </div>
                    </form>
                  )}
                  <form action={dismissReviewAction} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <input type="hidden" name="rawEventId" value={event.id} />
                    <Field label="Dismiss reason" htmlFor={`${parse.id}-dismiss`} className="flex-1">
                      <Input id={`${parse.id}-dismiss`} name="reason" required minLength={3} placeholder={isSignal ? "e.g. Not a tradable signal" : "e.g. Commentary only"} />
                    </Field>
                    <Button type="submit" variant="outline">
                      <X data-icon="inline-start" />
                      Dismiss
                    </Button>
                  </form>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
