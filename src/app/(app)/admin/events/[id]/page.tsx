import { Inbox, ListChecks, MessageSquareText, RotateCcw, ScanSearch } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { reparseEventAction } from "@/app/actions/admin";
import { JsonBlock, Notice, StateBadge } from "@/components/admin-bits";
import { PageHeader, SectionTitle } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
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
        icon={Inbox}
        size="sm"
        title="Raw event"
        description={`${source.name} · published ${fmtDateTime(event.publishedAt)} · received ${fmtDateTime(event.receivedAt)}`}
        actions={
          <>
            {d.signalId && (
              <Link href={`/admin/signals/${d.signalId}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                <ListChecks data-icon="inline-start" />
                Open signal
              </Link>
            )}
            <form action={reparseEventAction}>
              <input type="hidden" name="id" value={event.id} />
              <Button type="submit" variant="outline" size="sm">
                <RotateCcw data-icon="inline-start" />
                Re-run parser
              </Button>
            </form>
          </>
        }
      />
      <Notice searchParams={sp} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="self-start">
          <CardHeader>
            <SectionTitle icon={MessageSquareText} title="Original message" className="mb-0" />
          </CardHeader>
          <CardContent className="space-y-3">
            <pre className="whitespace-pre-wrap rounded-lg border border-glow/20 bg-[#050b18] p-3 font-mono text-xs leading-relaxed">{event.rawText}</pre>
            {event.rawPayloadJson && <JsonBlock value={event.rawPayloadJson} />}
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">Event id</dt>
              <dd className="font-mono">{event.id}</dd>
              <dt className="text-muted-foreground">External id</dt>
              <dd className="font-mono">{event.externalMessageId ?? "—"}</dd>
              <dt className="text-muted-foreground">Content hash</dt>
              <dd className="truncate font-mono">{event.contentHash}</dd>
              <dt className="text-muted-foreground">Parser</dt>
              <dd className="font-mono">{source.parserType}</dd>
            </dl>
          </CardContent>
        </Card>
        <Card className="self-start">
          <CardHeader>
            <SectionTitle icon={ScanSearch} title="Parse attempts" className="mb-0" />
          </CardHeader>
          <CardContent className="space-y-3">
            {parses.map((p) => (
              <div key={p.id} className={cn("space-y-2 rounded-lg border p-3", p.isCurrent ? "border-primary/45 bg-primary/[0.05]" : "border-glow/20 bg-black/15")}>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <StateBadge state={p.status} />
                  {p.isCurrent && <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">current</span>}
                  <span className="font-mono font-medium">{p.eventType}</span>
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
                  <summary className="cursor-pointer text-xs font-medium text-[#8db6ff] hover:text-primary">Parser output</summary>
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
