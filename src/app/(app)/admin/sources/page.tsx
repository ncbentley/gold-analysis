import Link from "next/link";
import { rerunAiAction, saveSourceAction, telegramAddJoinedChatAction } from "@/app/actions/admin";
import { Field, NativeSelect, Notice } from "@/components/admin-bits";
import { TelegramChatMenu } from "@/components/telegram-chat-menu";
import { PageHeader } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { fmtAge } from "@/lib/format";
import { sourceEventCounts } from "@/server/admin";
import { appUrl } from "@/server/auth";
import { requireAdmin } from "@/server/auth/guards";
import { PARSER_TYPES } from "@/server/parsing";
import { listSources } from "@/server/signals/queries";
import { connectTelegram, listJoinedTelegramChats, telegramStatus, type JoinedChat } from "@/server/telegram";

function chatOptionLabel(chat: JoinedChat, tracked: boolean) {
  const kind = chat.kind === "channel" ? "Channel" : "Group";
  const handle = chat.username ? ` (@${chat.username})` : "";
  return `${chat.title}${handle} · ${kind}${tracked ? " · already tracked" : ""}`;
}

export const metadata = { title: "Sources" };

export default async function AdminSourcesPage({ searchParams }: PageProps<"/admin/sources">) {
  await requireAdmin();
  const sp = await searchParams;
  const [sources, counts, initialTelegram] = await Promise.all([
    listSources({ includeInactive: true, includeQa: true }),
    sourceEventCounts(),
    telegramStatus(),
  ]);
  let telegram = initialTelegram;
  if (telegram.signedIn && !telegram.connected && !telegram.pending) {
    await Promise.race([connectTelegram(), new Promise((resolve) => setTimeout(resolve, 4000))]);
    telegram = await telegramStatus();
  }
  let joinedChats: JoinedChat[] = [];
  let listError: string | null = null;
  if (telegram.connected) {
    try {
      joinedChats = (await listJoinedTelegramChats()).chats;
    } catch (err) {
      listError = (err as Error).message;
    }
  }
  const trackedIds = new Set(sources.map((s) => s.telegramChannelId).filter((id): id is string => Boolean(id)));
  const channels = joinedChats.filter((c) => c.kind === "channel");
  const groups = joinedChats.filter((c) => c.kind === "group");
  const editId = typeof sp.edit === "string" ? sp.edit : null;
  const editing = editId && editId !== "new" ? sources.find((s) => s.id === editId) ?? null : null;
  const showForm = editId === "new" || editing;

  return (
    <>
      <PageHeader
        title="Sources"
        description="Every tracked signal provider. A Telegram source is chosen from the channels and groups the connected account has already joined. Webhook and manual sources are for integrations and backfills. Disabling a source stops ingestion but keeps its history."
        actions={
          <Link href="/admin/sources?edit=new" className={buttonVariants({ size: "sm", variant: "outline" })}>
            Add webhook or manual source
          </Link>
        }
      />
      <Notice searchParams={sp} />

      <Card className="mb-6 bg-card/60" id="add-telegram">
        <CardHeader>
          <CardTitle className="text-base">Add a Telegram source</CardTitle>
          <CardDescription>Choose a channel or group the connected account is already in. The source name is that chat&apos;s title on Telegram.</CardDescription>
        </CardHeader>
        <CardContent>
          {!telegram.connected && (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                Telegram is not connected.{" "}
                <Link href="/admin/telegram" className="text-primary hover:underline">
                  Connect a Telegram account
                </Link>{" "}
                on the Telegram page, then choose a channel or group that account has joined.
              </p>
              {telegram.lastError && <p className="text-loss">{telegram.lastError}</p>}
            </div>
          )}
          {telegram.connected && listError && <p className="text-sm text-loss">{listError}</p>}
          {telegram.connected && !listError && joinedChats.length === 0 && (
            <p className="text-sm text-muted-foreground">This account is not in any channels or groups. Join one in Telegram, then reload this page.</p>
          )}
          {telegram.connected && !listError && joinedChats.length > 0 && (
            <form action={telegramAddJoinedChatAction} className="grid gap-3 md:grid-cols-2">
              <Field label="Channel or group" htmlFor="ch-pick" hint="Only chats this account has joined are listed." className="md:col-span-2">
                <TelegramChatMenu
                  channels={channels.map((c) => ({ id: c.id, label: chatOptionLabel(c, trackedIds.has(c.id)) }))}
                  groups={groups.map((c) => ({ id: c.id, label: chatOptionLabel(c, trackedIds.has(c.id)) }))}
                />
              </Field>
              <Field label="Parser" htmlFor="ch-parser">
                <NativeSelect id="ch-parser" name="parserType" defaultValue={PARSER_TYPES[0]}>
                  {PARSER_TYPES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field label="Import recent history" htmlFor="ch-backfill" hint="Messages to import now (0 to 1000). 0 captures new posts only.">
                <Input id="ch-backfill" name="backfill" type="number" min={0} max={1000} defaultValue={200} />
              </Field>
              <div className="flex items-end justify-between gap-3 md:col-span-2">
                <label className="flex items-center gap-2 pb-2 text-sm">
                  <input type="checkbox" name="isQa" className="accent-primary" /> QA source (admins only)
                </label>
                <Button type="submit">Add source</Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

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
                  No sources yet.{" "}
                  {telegram.connected ? (
                    "Choose a channel or group above."
                  ) : (
                    <>
                      Telegram is not connected.{" "}
                      <Link href="/admin/telegram" className="text-primary hover:underline">
                        Connect an account
                      </Link>
                    </>
                  )}
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
