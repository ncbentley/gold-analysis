import Link from "next/link";
import { dismissReviewAction, resolveReviewAction } from "@/app/actions/admin";
import { Field, Notice, StateBadge } from "@/components/admin-bits";
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
        title="Review queue"
        description="The model reviews these posts first. A post stays here when the model is unsure or its confidence is under 80%. Create the signal with corrected fields, or dismiss the message. Every decision is audited."
      />
      <Notice searchParams={sp} />
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">The queue is empty. Posts the model cannot decide are listed here.</div>
      ) : (
        <div className="space-y-4">
          {items.map(({ event, source, parse }) => {
            const out = parse.outputJson as unknown as ParseOutput;
            const s = out.signal;
            const isSignal = parse.eventType === "NEW_SIGNAL";
            return (
              <Card key={parse.id} className="bg-card/60">
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                    <span>{source.name}</span>
                    <span className="font-normal text-muted-foreground">· {fmtDateTime(event.publishedAt)}</span>
                    <StateBadge state={parse.status} />
                    <span className="rounded-md border px-1.5 py-0.5 text-[11px] text-muted-foreground">{parse.eventType}</span>
                    <span className="text-xs font-normal text-muted-foreground">confidence {(parse.confidence * 100).toFixed(0)}%</span>
                    <Link href={`/admin/events/${event.id}`} className="ml-auto text-xs font-normal text-primary hover:underline">
                      Event detail
                    </Link>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <pre className="whitespace-pre-wrap rounded-md border bg-background/60 p-3 font-mono text-xs">{event.rawText}</pre>
                  {parse.issues.length > 0 && (
                    <ul className="list-inside list-disc text-xs text-amber-300/90">
                      {parse.issues.map((i) => (
                        <li key={i}>{i}</li>
                      ))}
                    </ul>
                  )}
                  {isSignal && (
                    <form action={resolveReviewAction} className="space-y-3 rounded-md border p-3">
                      <div className="text-xs font-medium">Create signal</div>
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
                          targets: s?.targets.value,
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
