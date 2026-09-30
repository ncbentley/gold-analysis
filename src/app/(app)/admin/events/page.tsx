import { ChevronLeft, ChevronRight, Filter, Inbox, PenLine } from "lucide-react";
import Link from "next/link";
import { ingestManualEventAction } from "@/app/actions/admin";
import { Field, NativeSelect, Notice, StateBadge } from "@/components/admin-bits";
import { ImportProgressRefresh } from "@/components/import-progress";
import { PageHeader, SectionTitle } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { fmtDateTime } from "@/lib/format";
import { listRawEvents } from "@/server/admin";
import { requireAdmin } from "@/server/auth/guards";
import { listSources } from "@/server/signals/queries";
import { messageQueueState } from "@/server/telegram/import-status";

export const metadata = { title: "Raw events" };

const STATUSES = ["queued", "applied", "needs_review", "failed", "ignored", "resolved"];
const PAGE = 50;

export default async function EventsPage({ searchParams }: PageProps<"/admin/events">) {
  await requireAdmin();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const page = Math.max(1, Number(one("page") ?? 1) || 1);
  const filters = { sourceId: one("source"), status: one("status") };
  const [{ rows, total }, sources] = await Promise.all([listRawEvents(filters, { limit: PAGE, offset: (page - 1) * PAGE }), listSources({ includeInactive: true, includeQa: true })]);
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ source: filters.sourceId, status: filters.status, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/admin/events${p.size ? `?${p}` : ""}`;
  };

  return (
    <>
      <PageHeader icon={Inbox} size="sm" title="Raw events" description="Every message exactly as received. Raw events are never edited; re-parsing creates a new parse result." />
      <ImportProgressRefresh active={sources.some((s) => s.importStatus === "queued" || s.importStatus === "importing") || filters.status === "queued"} />
      <Notice searchParams={sp} />

      <form className="panel mb-4 flex flex-wrap items-end gap-3 rounded-xl px-4 py-3 ring-1 ring-glow/30">
        <Field label="Source" htmlFor="f-source" className="w-48">
          <NativeSelect id="f-source" name="source" defaultValue={filters.sourceId ?? ""}>
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="Parse status" htmlFor="f-status" className="w-44">
          <NativeSelect id="f-status" name="status" defaultValue={filters.status ?? ""}>
            <option value="">Any</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ")}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Button type="submit" variant="outline">
          <Filter data-icon="inline-start" />
          Filter
        </Button>
        <span className="ml-auto self-center text-xs font-medium text-muted-foreground">
          <span className="font-mono text-foreground tabular-nums">{total.toLocaleString()}</span> events
        </span>
      </form>

      <Card className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-40">Published</TableHead>
              <TableHead className="w-32">Source</TableHead>
              <TableHead>Message</TableHead>
              <TableHead className="w-28">Type</TableHead>
              <TableHead className="w-28">Parse</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                  No events match these filters.
                </TableCell>
              </TableRow>
            )}
            {rows.map(({ event, source, parse }) => (
              <TableRow key={event.id}>
                <TableCell className="text-xs text-muted-foreground tabular-nums">{fmtDateTime(event.publishedAt)}</TableCell>
                <TableCell className="text-xs font-medium">{source.name}</TableCell>
                <TableCell className="max-w-0">
                  <Link href={`/admin/events/${event.id}`} className="block truncate rounded font-mono text-xs text-foreground/90 outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                    {event.rawText}
                  </Link>
                </TableCell>
                <TableCell className="font-mono text-[11px] text-muted-foreground">{parse?.eventType ?? event.eventType ?? "—"}</TableCell>
                <TableCell>
                  <StateBadge state={messageQueueState(parse?.status)} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <div className="mt-4 flex justify-between">
        {page > 1 ? (
          <Link href={qs({ page: String(page - 1) })} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ChevronLeft data-icon="inline-start" />
            Previous
          </Link>
        ) : (
          <span />
        )}
        {page * PAGE < total && (
          <Link href={qs({ page: String(page + 1) })} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Next
            <ChevronRight data-icon="inline-end" />
          </Link>
        )}
      </div>

      <Card className="mt-6">
        <CardHeader>
          <SectionTitle icon={PenLine} title="Record an event manually" className="mb-0" />
        </CardHeader>
        <CardContent>
          <form action={ingestManualEventAction} className="grid gap-3 md:grid-cols-3">
            <Field label="Source" htmlFor="m-source">
              <NativeSelect id="m-source" name="sourceId" required defaultValue="">
                <option value="" disabled>
                  Choose a source
                </option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.parserType})
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label="Published at (UTC)" htmlFor="m-time" hint="Defaults to now">
              <Input id="m-time" name="publishedAt" type="datetime-local" />
            </Field>
            <Field label="External message id" htmlFor="m-ext" hint="Optional; used for de-duplication and replies">
              <Input id="m-ext" name="externalMessageId" />
            </Field>
            <Field label="Message text" htmlFor="m-text" className="md:col-span-2">
              <Textarea id="m-text" name="rawText" required rows={4} placeholder={"XAUUSD BUY 3398-3402\nSL 3390\nTP1 3410 TP2 3420"} className="font-mono text-xs" />
            </Field>
            <Field label="JSON payload" htmlFor="m-payload" hint="Optional, for JSON parsers">
              <Textarea id="m-payload" name="payload" rows={4} className="font-mono text-xs" placeholder='{"action":"open", ...}' />
            </Field>
            <div className="md:col-span-3">
              <Button type="submit">Record and parse</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
