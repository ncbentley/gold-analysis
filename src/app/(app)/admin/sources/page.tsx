import { Pencil, Plus, Radio, Send } from "lucide-react";
import Link from "next/link";
import { removeSourceAction, rerunAiAction, saveSourceAction, telegramAddJoinedChatAction } from "@/app/actions/admin";
import { Field, NativeSelect, Notice, StateBadge } from "@/components/admin-bits";
import { AddSourceButton, ImportProgressRefresh } from "@/components/import-progress";
import { TelegramChatMenu } from "@/components/telegram-chat-menu";
import { PageHeader, SectionTitle } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { fmtAge } from "@/lib/format";
import { cn } from "@/lib/utils";
import { sourceEventCounts } from "@/server/admin";
import { appUrl } from "@/server/auth";
import { requireAdmin } from "@/server/auth/guards";
import { PARSER_TYPES } from "@/server/parsing";
import { listSources } from "@/server/signals/queries";
import { connectTelegram, listJoinedTelegramChats, telegramStatus, type JoinedChat } from "@/server/telegram";
import { joinableTelegramChats } from "@/server/telegram/joinable";

function chatOptionLabel(chat: JoinedChat) {
  const kind = chat.kind === "channel" ? "Channel" : "Group";
  const handle = chat.username ? ` (@${chat.username})` : "";
  return `${chat.title}${handle} · ${kind}`;
}

export const metadata = { title: "Sources" };

const ACTION = "mr-3 rounded text-xs font-medium text-[#8db6ff] outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring";

export default async function AdminSourcesPage({ searchParams }: PageProps<"/admin/sources">) {
  await requireAdmin();
  const sp = await searchParams;
  const [sources, counts, initialTelegram] = await Promise.all([
    listSources({ includeInactive: true, includeQa: true }),
    sourceEventCounts(),
    telegramStatus(),
  ]);
  const queueOwnsTelegram = process.env.JOBS_WORKER === "off" && Boolean(process.env.QUEUE_URL);
  let telegram = initialTelegram;
  if (!queueOwnsTelegram && telegram.signedIn && !telegram.connected && !telegram.pending) {
    await Promise.race([connectTelegram(), new Promise((resolve) => setTimeout(resolve, 4000))]);
    telegram = await telegramStatus();
  }
  let joinedChats: JoinedChat[] = [];
  let listError: string | null = null;
  let connected = telegram.connected;
  if (queueOwnsTelegram ? telegram.signedIn && !telegram.pending : telegram.connected) {
    try {
      const listed = await listJoinedTelegramChats();
      connected = listed.connected;
      joinedChats = listed.chats;
    } catch (err) {
      listError = (err as Error).message;
    }
  }
  const trackedIds = new Set(sources.map((s) => s.telegramChannelId).filter((id): id is string => Boolean(id)));
  const availableChats = joinableTelegramChats(joinedChats, trackedIds);
  const editId = typeof sp.edit === "string" ? sp.edit : null;
  const editing = editId && editId !== "new" ? sources.find((s) => s.id === editId) ?? null : null;
  const showForm = editId === "new" || editing;

  return (
    <>
      <PageHeader
        icon={Radio}
        size="sm"
        title="Sources"
        description="Every tracked signal provider. A Telegram source is chosen from the channels and groups the connected account has already joined. Webhook and manual sources are for integrations and backfills."
        actions={
          <Link href="/admin/sources?edit=new" className={buttonVariants({ size: "sm", variant: "outline" })}>
            <Plus data-icon="inline-start" />
            Add webhook or manual source
          </Link>
        }
      />
      <ImportProgressRefresh active={sources.some((s) => s.importStatus === "queued" || s.importStatus === "importing")} />
      <Notice searchParams={sp} />

      <Card className="panel-gold mb-5 scroll-mt-24 ring-primary/55 shadow-[0_0_28px_-8px_rgb(245_197_66/0.55)]" id="add-telegram">
        <CardHeader>
          <SectionTitle icon={Send} title="Add a Telegram source" className="mb-0" />
          <CardDescription>
            Check the channels and groups to add, then click Add once. Each one is queued on its own. A channel already importing does not block the next add. The row
            shows queued, then importing, then caught up or failed, and each message shows as queued until it is read.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!connected && (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                Telegram is not connected.{" "}
                <Link href="/admin/telegram" className="text-primary hover:underline">
                  Connect a Telegram account
                </Link>{" "}
                on the Telegram page, then choose a channel or group that account has joined.
              </p>
              {telegram.lastError && <p className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-loss">{telegram.lastError}</p>}
            </div>
          )}
          {connected && listError && <p className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">{listError}</p>}
          {connected && !listError && joinedChats.length === 0 && (
            <p className="text-sm text-muted-foreground">This account is not in any channels or groups. Join one in Telegram, then reload this page.</p>
          )}
          {connected && !listError && joinedChats.length > 0 && availableChats.length === 0 && (
            <p className="text-sm text-muted-foreground">Every channel and group this account is in is already a source.</p>
          )}
          {connected && !listError && availableChats.length > 0 && (
            <form action={telegramAddJoinedChatAction} className="grid gap-3 md:grid-cols-2">
              <Field label="Channels and groups" htmlFor="ch-pick" hint="Filter the list and check the ones to add. Channels that are already sources are left off this list." className="md:col-span-2">
                <TelegramChatMenu
                  chats={availableChats.map((chat) => ({
                    id: chat.id,
                    accessHash: chat.accessHash,
                    username: chat.username,
                    title: chat.title,
                    kind: chat.kind,
                    label: chatOptionLabel(chat),
                  }))}
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
              <Field label="Import recent history" htmlFor="ch-backfill" hint="Messages to queue now (0 to 1000). 0 captures new posts only. The row updates as soon as you add the source.">
                <Input id="ch-backfill" name="backfill" type="number" min={0} max={1000} defaultValue={200} className="font-mono tabular-nums" />
              </Field>
              <div className="flex items-end justify-between gap-3 md:col-span-2">
                <label className="flex items-center gap-2 pb-2 text-sm font-medium">
                  <input type="checkbox" name="isQa" className="size-4 accent-primary" /> QA source (admins only)
                </label>
                <AddSourceButton />
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      {showForm && (
        <Card className="mb-5">
          <CardHeader>
            <SectionTitle icon={editing ? Pencil : Plus} title={editing ? `Edit ${editing.name}` : "New source"} className="mb-0" />
          </CardHeader>
          <CardContent>
            <form action={saveSourceAction} className="grid gap-3 md:grid-cols-3">
              {editing && <input type="hidden" name="id" value={editing.id} />}
              <Field label="Name" htmlFor="s-name">
                <Input id="s-name" name="name" required defaultValue={editing?.name} />
              </Field>
              <Field label="Slug" htmlFor="s-slug" hint="Used in page and ingest URLs">
                <Input id="s-slug" name="slug" required pattern="[a-z0-9-]+" defaultValue={editing?.slug} className="font-mono" />
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
              <div className="flex flex-wrap items-center gap-5 text-sm font-medium md:col-span-3">
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

      <SectionTitle icon={Radio} title="Tracked sources" action={<span className="text-xs font-medium text-muted-foreground"><span className="font-mono text-foreground tabular-nums">{sources.length}</span> total</span>} />
      <Card className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Source</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Import</TableHead>
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
                <TableCell colSpan={9} className="py-10 text-center text-sm text-muted-foreground">
                  No sources yet.{" "}
                  {connected ? (
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
                    <div className="font-semibold">{s.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {s.active ? "active" : "disabled"}
                      {s.isQa && " · QA, admins only"}
                      {(c?.queued ?? 0) > 0 && ` · ${c?.queued} queued`}
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
                  <TableCell>
                    {s.importStatus ? <StateBadge state={s.importStatus} /> : <span className="text-xs text-muted-foreground">—</span>}
                    {s.importStatus === "failed" && s.syncError && <div className="mt-1 max-w-56 text-xs text-loss">{s.syncError}</div>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.parserType}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{c?.events ?? 0}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{c?.signals ?? 0}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c?.last ? `${fmtAge(c.last)} ago` : "never"}</TableCell>
                  <TableCell className="max-w-56 truncate font-mono text-[11px] text-muted-foreground">
                    {s.sourceType === "webhook" ? `POST ${appUrl()}/api/v1/ingest/${s.slug}` : s.sourceType === "telegram" ? "Telegram live updates" : "—"}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Link href={`/admin/events?source=${s.id}`} className={ACTION}>
                      Events
                    </Link>
                    <Link href={`/admin/sources?edit=${s.id}`} className={ACTION}>
                      Edit
                    </Link>
                    <form action={removeSourceAction} className="inline">
                      <input type="hidden" name="id" value={s.id} />
                      <button type="submit" className={cn(ACTION, "text-loss hover:text-loss")}>
                        Remove
                      </button>
                    </form>
                    <form action={rerunAiAction} className="inline">
                      <input type="hidden" name="sourceId" value={s.id} />
                      <button type="submit" className={cn(ACTION, "mr-0")}>
                        Re-run AI patterns
                      </button>
                    </form>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
