import Link from "next/link";
import { notFound } from "next/navigation";
import { reparseEventAction } from "@/app/actions/admin";
import { JsonBlock, Notice, StateBadge } from "@/components/admin-bits";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDateTime } from "@/lib/format";
import { getRawEventDetail } from "@/server/admin";
import { requireAdmin } from "@/server/auth/guards";

export const metadata = { title: "Event" };

export default async function EventDetailPage({ params, searchParams }: PageProps<"/admin/events/[id]">) {
  await requireAdmin();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const d = await getRawEventDetail(id);
  if (!d) notFound();
  const { event, source, parses } = d;

  return (
    <>
      <PageHeader
        title="Raw event"
        description={`${source.name} · published ${fmtDateTime(event.publishedAt)} · received ${fmtDateTime(event.receivedAt)}`}
        actions={
          <>
            {d.signalId && (
              <Link href={`/admin/signals/${d.signalId}`} className="text-sm text-primary hover:underline">
                Open signal
              </Link>
            )}
            <form action={reparseEventAction}>
              <input type="hidden" name="id" value={event.id} />
              <Button type="submit" variant="outline" size="sm">
                Re-run parser
              </Button>
            </form>
          </>
        }
      />
      <Notice searchParams={sp} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-card/60">
          <CardHeader>
            <CardTitle className="text-base">Original message</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <pre className="whitespace-pre-wrap rounded-md border bg-background/60 p-3 font-mono text-xs">{event.rawText}</pre>
            {event.rawPayloadJson && <JsonBlock value={event.rawPayloadJson} />}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Event id</dt>
              <dd className="font-mono">{event.id}</dd>
              <dt className="text-muted-foreground">External id</dt>
              <dd className="font-mono">{event.externalMessageId ?? "—"}</dd>
              <dt className="text-muted-foreground">Content hash</dt>
              <dd className="truncate font-mono">{event.contentHash}</dd>
              <dt className="text-muted-foreground">Parser</dt>
              <dd>{source.parserType}</dd>
            </dl>
          </CardContent>
        </Card>
        <Card className="bg-card/60">
          <CardHeader>
            <CardTitle className="text-base">Parse attempts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {parses.map((p) => (
              <div key={p.id} className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <StateBadge state={p.status} />
                  {p.isCurrent && <span className="text-primary">current</span>}
                  <span>{p.eventType}</span>
                  <span className="text-muted-foreground">
                    {p.parserType}@{p.parserVersion} · {(p.confidence * 100).toFixed(0)}% · {fmtDateTime(p.createdAt)}
                  </span>
                </div>
                {p.issues.length > 0 && (
                  <ul className="list-inside list-disc text-xs text-amber-300/90">
                    {p.issues.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                )}
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">Parser output</summary>
                  <JsonBlock value={p.outputJson} className="mt-2" />
                </details>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
