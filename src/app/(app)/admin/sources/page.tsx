import Link from "next/link";
import { rerunAiAction, saveSourceAction } from "@/app/actions/admin";
import { Field, NativeSelect, Notice } from "@/components/admin-bits";
import { PageHeader } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { fmtAge } from "@/lib/format";
import { sourceEventCounts } from "@/server/admin";
import { appUrl } from "@/server/auth";
import { requireAdmin } from "@/server/auth/guards";
import { PARSER_TYPES } from "@/server/parsing";
import { listSources } from "@/server/signals/queries";

export const metadata = { title: "Sources" };

export default async function AdminSourcesPage({ searchParams }: PageProps<"/admin/sources">) {
  await requireAdmin();
  const sp = await searchParams;
  const [sources, counts] = await Promise.all([listSources({ includeInactive: true, includeQa: true }), sourceEventCounts()]);
  const editId = typeof sp.edit === "string" ? sp.edit : null;
  const editing = editId && editId !== "new" ? sources.find((s) => s.id === editId) ?? null : null;
  const showForm = editId === "new" || editing;

  return (
    <>
      <PageHeader
        title="Sources"
        description="Every tracked signal provider. Telegram channels are the primary source and are added from the Telegram page; webhook and manual sources are for integrations and backfills. Disabling a source stops ingestion but keeps its history."
        actions={
          <div className="flex gap-2">
            <Link href="/admin/sources?edit=new" className={buttonVariants({ size: "sm", variant: "outline" })}>
              Add webhook or manual source
            </Link>
            <Link href="/admin/telegram" className={buttonVariants({ size: "sm" })}>
              Add Telegram channel
            </Link>
          </div>
        }
      />
      <Notice searchParams={sp} />

      {showForm && (
        <Card className="mb-6 bg-card/60">
          <CardHeader>
            <CardTitle className="text-base">{editing ? `Edit ${editing.name}` : "New source"}</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={saveSourceAction} className="grid gap-3 md:grid-cols-3">
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <Field label="Name" htmlFor="s-name">
                <Input id="s-name" name="name" required defaultValue={editing?.name} />
              </Field>
              <Field label="Slug" htmlFor="s-slug" hint="Used in page and ingest URLs">
                <Input id="s-slug" name="slug" required pattern="[a-z0-9-]+" defaultValue={editing?.slug} />
              </Field>
              <Field label="Source type" htmlFor="s-type">
                {editing?.sourceType === "telegram" ? (
                  <>
                    <input type="hidden" name="sourceType" value="telegram" />
                    <Input id="s-type" disabled value={`Telegram${editing.telegramUsername ? ` (@${editing.telegramUsername})` : ""}`} />
                  </>
                ) : (
                  <NativeSelect id="s-type" name="sourceType" defaultValue={editing?.sourceType ?? "webhook"}>
                    <option value="webhook">Webhook</option>
                    <option value="manual">Manual</option>
                  </NativeSelect>
                )}
              </Field>
              <Field label="Parser" htmlFor="s-parser">
                <NativeSelect id="s-parser" name="parserType" defaultValue={editing?.parserType ?? PARSER_TYPES[0]}>
                  {PARSER_TYPES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Source URL" htmlFor="s-url">
                <Input id="s-url" name="sourceUrl" type="url" defaultValue={editing?.sourceUrl ?? ""} />
              </Field>
              <Field label="Timezone" htmlFor="s-tz">
                <Input id="s-tz" name="timezone" defaultValue={editing?.timezone ?? "UTC"} />
              </Field>
              <Field label="Description" htmlFor="s-desc" className="md:col-span-3">
                <Textarea id="s-desc" name="description" rows={2} defaultValue={editing?.description ?? ""} />
              </Field>
              <div className="flex flex-wrap items-center gap-5 text-sm md:col-span-3">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="active" defaultChecked={editing?.active ?? true} className="accent-primary" /> Active
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="showRawText" defaultChecked={editing?.showRawText ?? true} className="accent-primary" /> Show original text to members
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="isQa" defaultChecked={editing?.isQa ?? false} className="accent-primary" /> QA source (admins only)
                </label>
                <div className="ml-auto flex gap-2">
                  <Link href="/admin/sources" className={buttonVariants({ variant: "ghost" })}>
                    Cancel
                  </Link>
                  <Button type="submit">Save source</Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="overflow-hidden rounded-lg border bg-card/40">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Parser</TableHead>
              <TableHead className="text-right">Events</TableHead>
              <TableHead className="text-right">Signals</TableHead>
              <TableHead>Last event</TableHead>
              <TableHead>Ingest endpoint</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-muted-foreground">
                  No sources yet. <Link href="/admin/telegram" className="text-primary hover:underline">Connect Telegram and add your first channel.</Link>
                </TableCell>
              </TableRow>
            )}
            {sources.map((s) => {
              const c = counts.get(s.id);
              return (
                <TableRow key={s.id} className={s.active ? undefined : "opacity-60"}>
                  <TableCell>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.active ? "active" : "disabled"}
                      {s.isQa && " · QA, admins only"}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {s.sourceType === "telegram" ? (
                      <span title={s.syncError ?? undefined} className={s.syncError ? "text-destructive" : undefined}>
                        Telegram{s.telegramUsername ? ` @${s.telegramUsername}` : ""}
                      </span>
                    ) : (
                      s.sourceType
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.parserType}</TableCell>
                  <TableCell className="text-right tabular-nums">{c?.events ?? 0}</TableCell>
                  <TableCell className="text-right tabular-nums">{c?.signals ?? 0}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c?.last ? `${fmtAge(c.last)} ago` : "never"}</TableCell>
                  <TableCell className="max-w-56 truncate font-mono text-[11px] text-muted-foreground">
                    {s.sourceType === "webhook" ? `POST ${appUrl()}/api/v1/ingest/${s.slug}` : s.sourceType === "telegram" ? "Telegram live updates" : "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Link href={`/admin/events?source=${s.id}`} className="mr-3 text-xs text-primary hover:underline">
                      Events
                    </Link>
                    <Link href={`/admin/sources?edit=${s.id}`} className="mr-3 text-xs text-primary hover:underline">
                      Edit
                    </Link>
                    <form action={rerunAiAction} className="inline">
                      <input type="hidden" name="sourceId" value={s.id} />
                      <button type="submit" className="text-xs text-primary hover:underline">
                        Re-run AI patterns
                      </button>
                    </form>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
