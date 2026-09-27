import Link from "next/link";
import { ingestManualEventAction } from "@/app/actions/admin";
import { Field, NativeSelect, Notice, StateBadge } from "@/components/admin-bits";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { fmtDateTime } from "@/lib/format";
import { listRawEvents } from "@/server/admin";
import { requireAdmin } from "@/server/auth/guards";
import { listSources } from "@/server/signals/queries";

export const metadata = { title: "Raw events" };

const STATUSES = ["applied", "needs_review", "failed", "ignored", "resolved"];
const PAGE = 50;

export default async function EventsPage({ searchParams }: PageProps<"/admin/events">) {
  await requireAdmin();
  const sp = await searchParams;
  const one = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const page = Math.max(1, Number(one("page") ?? 1) || 1);
  const filters = { sourceId: one("source"), status: one("status") };
  const [{ rows, total }, sources] = await Promise.all([listRawEvents(filters, { limit: PAGE, offset: (page - 1) * PAGE }), listSources({ includeInactive: true })]);
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ source: filters.sourceId, status: filters.status, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/admin/events${p.size ? `?${p}` : ""}`;
  };

  return (
    <>
      <PageHeader title="Raw events" description="Every message exactly as received. Raw events are never edited; re-parsing creates a new parse result." />
      <Notice searchParams={sp} />

      <form className="mb-4 flex flex-wrap items-end gap-2">
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
        <Button type="submit" variant="outline" size="sm">
          Filter
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">{total.toLocaleString()} events</span>
      </form>

      <div className="overflow-hidden rounded-lg border bg-card/40">
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
                <TableCell className="text-xs text-muted-foreground">{fmtDateTime(event.publishedAt)}</TableCell>
                <TableCell className="text-xs">{source.name}</TableCell>
                <TableCell className="max-w-0">
                  <Link href={`/admin/events/${event.id}`} className="block truncate font-mono text-xs hover:text-primary">
                    {event.rawText}
                  </Link>
                </TableCell>
                <TableCell className="text-xs">{parse?.eventType ?? event.eventType ?? "—"}</TableCell>
                <TableCell>
                  <StateBadge state={parse?.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="mt-3 flex justify-between text-sm">
        {page > 1 ? <Link href={qs({ page: String(page - 1) })} className="text-primary hover:underline">Previous</Link> : <span />}
        {page * PAGE < total && <Link href={qs({ page: String(page + 1) })} className="text-primary hover:underline">Next</Link>}
      </div>

      <Card className="mt-8 bg-card/60">
        <CardHeader>
          <CardTitle className="text-base">Record an event manually</CardTitle>
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
