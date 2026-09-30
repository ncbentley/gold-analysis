import { ArrowRight, Radio, Send, UserRound } from "lucide-react";
import Link from "next/link";
import {
  telegramCancelLoginAction,
  telegramReconnectAction,
  telegramSendCodeAction,
  telegramSignOutAction,
  telegramSyncSourceAction,
  telegramVerifyAction,
} from "@/app/actions/admin";
import { Field, Notice, StateBadge } from "@/components/admin-bits";
import { ImportProgressRefresh } from "@/components/import-progress";
import { PageHeader, SectionTitle } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtAge } from "@/lib/format";
import { cn } from "@/lib/utils";
import { sourceEventCounts } from "@/server/admin";
import { requireAdmin } from "@/server/auth/guards";
import { secretKeySource } from "@/server/settings";
import { listSources } from "@/server/signals/queries";
import { connectTelegram, telegramStatus } from "@/server/telegram";

export const metadata = { title: "Telegram" };

const ACTION = "mr-3 rounded text-xs font-medium text-[#8db6ff] outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring";

export default async function AdminTelegramPage({ searchParams }: PageProps<"/admin/telegram">) {
  await requireAdmin();
  const sp = await searchParams;
  let status = await telegramStatus();
  const queueOwnsTelegram = process.env.JOBS_WORKER === "off" && Boolean(process.env.QUEUE_URL);
  if (!queueOwnsTelegram && status.signedIn && !status.connected && !status.pending) {
    await Promise.race([connectTelegram(), new Promise((r) => setTimeout(r, 4000))]);
    status = await telegramStatus();
  }
  const [all, counts] = await Promise.all([listSources({ includeInactive: true, includeQa: true }), sourceEventCounts()]);
  const channels = all.filter((s) => s.sourceType === "telegram");
  const keySource = secretKeySource();

  return (
    <>
      <PageHeader
        icon={Send}
        size="sm"
        title="Telegram"
        description="Signals are captured through a Telegram user account. Connect it here. Channels and groups it has already joined are added from Sources."
      />
      <ImportProgressRefresh active={channels.some((s) => s.importStatus === "queued" || s.importStatus === "importing")} />
      <Notice searchParams={sp} />

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className={cn("lg:col-span-2", status.connected && "panel-gold ring-primary/55 shadow-[0_0_28px_-8px_rgb(245_197_66/0.55)]")}>
          <CardHeader>
            <SectionTitle
              icon={UserRound}
              title="Account"
              className="mb-0"
              action={
                status.connected ? (
                  <Badge className="border-win/45 bg-win/10 font-semibold text-win shadow-[0_0_12px_-4px_var(--win)]" variant="outline">
                    <span className="size-1.5 rounded-full bg-current" />
                    Connected
                  </Badge>
                ) : status.signedIn ? (
                  <Badge variant="outline" className="border-amber-400/45 bg-amber-400/10 font-semibold text-amber-300">
                    Not connected
                  </Badge>
                ) : (
                  <Badge variant="outline" className="font-semibold text-muted-foreground">
                    Signed out
                  </Badge>
                )
              }
            />
            <CardDescription>
              {status.signedIn
                ? "The session is stored encrypted in the database. New posts arrive live; a catch-up sync also runs every two minutes."
                : "Use a dedicated Telegram account that has joined (or can join) the signal channels. Messages are only read, never sent."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            {status.lastError && <p className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-loss">{status.lastError}</p>}

            {status.signedIn && status.me && (
              <>
                <div className="rounded-lg border border-glow/25 bg-black/20 px-3 py-2.5">
                  <div className="font-semibold">{status.me.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {[status.me.username && `@${status.me.username}`, status.me.phone, status.apiId && `API ID ${status.apiId}`].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!status.connected && (
                    <form action={telegramReconnectAction}>
                      <Button type="submit" size="sm">
                        Reconnect
                      </Button>
                    </form>
                  )}
                  <form action={telegramSignOutAction}>
                    <Button type="submit" size="sm" variant="outline">
                      Sign out of Telegram
                    </Button>
                  </form>
                </div>
              </>
            )}

            {!status.signedIn && !status.pending && (
              <form action={telegramSendCodeAction} className="space-y-3">
                <ol className="list-decimal space-y-1.5 rounded-lg border border-glow/20 bg-black/15 py-2.5 pr-3 pl-7 text-xs text-muted-foreground marker:font-semibold marker:text-primary">
                  <li>
                    Sign in at{" "}
                    <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      my.telegram.org/apps
                    </a>{" "}
                    with the account&apos;s phone number and create an application.
                  </li>
                  <li>Copy the App api_id and api_hash below.</li>
                  <li>Telegram sends a login code to that account. Enter it in the next step.</li>
                </ol>
                <div className="grid grid-cols-3 gap-3">
                  <Field label="API ID" htmlFor="tg-api-id">
                    <Input id="tg-api-id" name="apiId" inputMode="numeric" required defaultValue={status.apiId ?? ""} autoComplete="off" className="font-mono" />
                  </Field>
                  <Field label="API hash" htmlFor="tg-api-hash" className="col-span-2">
                    <Input id="tg-api-hash" name="apiHash" required autoComplete="off" spellCheck={false} placeholder="32 hex characters" className="font-mono" />
                  </Field>
                </div>
                <Field label="Phone number" htmlFor="tg-phone" hint="International format, including the country code.">
                  <Input id="tg-phone" name="phone" type="tel" required placeholder="+447700900123" autoComplete="off" className="font-mono" />
                </Field>
                <Button type="submit" className="w-full">
                  Send login code
                </Button>
                {keySource === "missing" && <p className="text-xs text-loss">APP_SECRET is not set, so credentials can&apos;t be stored. Set it and restart.</p>}
              </form>
            )}

            {status.pending && (
              <div className="space-y-3">
                <p className="text-muted-foreground">
                  {status.pending.needsPassword
                    ? "This account uses two-step verification. Enter the Telegram cloud password."
                    : status.pending.viaApp
                      ? `A code was sent to the Telegram app signed in as ${status.pending.phone}.`
                      : `A code was sent by SMS to ${status.pending.phone}.`}
                </p>
                <form action={telegramVerifyAction} className="space-y-3">
                  {status.pending.needsPassword ? (
                    <Field label="Two-step verification password" htmlFor="tg-password" hint={status.pending.passwordHint ? `Hint: ${status.pending.passwordHint}` : undefined}>
                      <Input id="tg-password" name="password" type="password" required autoComplete="off" autoFocus />
                    </Field>
                  ) : (
                    <Field label="Login code" htmlFor="tg-code">
                      <Input id="tg-code" name="code" inputMode="numeric" required autoComplete="one-time-code" autoFocus placeholder="12345" className="font-mono tracking-widest" />
                    </Field>
                  )}
                  <Button type="submit" className="w-full">
                    {status.pending.needsPassword ? "Verify password" : "Sign in"}
                  </Button>
                </form>
                <form action={telegramCancelLoginAction}>
                  <Button type="submit" variant="ghost" size="sm" className="w-full">
                    Cancel
                  </Button>
                </form>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="self-start lg:col-span-3">
          <CardHeader>
            <SectionTitle icon={Radio} title="Add a source" className="mb-0" />
            <CardDescription>Sources are chosen from the channels and groups this account has already joined. Join a chat in Telegram first.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>There is no field to type a channel name. The list on Sources uses the titles Telegram already has for this account.</p>
            <Link href="/admin/sources#add-telegram" className={buttonVariants({ size: "sm" })}>
              Choose a channel or group
              <ArrowRight data-icon="inline-end" />
            </Link>
          </CardContent>
        </Card>
      </div>

      <SectionTitle icon={Send} title="Tracked channels" className="mt-7" />
      <Card className="gap-0 py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Channel</TableHead>
              <TableHead>Parser</TableHead>
              <TableHead className="text-right">Messages</TableHead>
              <TableHead className="text-right">Signals</TableHead>
              <TableHead>Last post</TableHead>
              <TableHead>Last sync</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {channels.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  No channels yet.{" "}
                  <Link href="/admin/sources#add-telegram" className="text-primary hover:underline">
                    Choose one on Sources
                  </Link>{" "}
                  after this account has joined it.
                </TableCell>
              </TableRow>
            )}
            {channels.map((s) => {
              const c = counts.get(s.id);
              return (
                <TableRow key={s.id} className={s.active ? undefined : "opacity-60"}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2 font-semibold">
                      {s.name}
                      {s.isQa && <Badge variant="secondary">QA</Badge>}
                      {!s.active && <Badge variant="outline">disabled</Badge>}
                      {s.importStatus && <StateBadge state={s.importStatus} />}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {s.telegramUsername ? (
                        <a href={`https://t.me/${s.telegramUsername}`} target="_blank" rel="noreferrer" className="font-mono hover:text-primary hover:underline">
                          @{s.telegramUsername}
                        </a>
                      ) : (
                        "private channel"
                      )}
                    </div>
                    {s.syncError && <div className="mt-1 max-w-80 text-xs text-loss">{s.syncError}</div>}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{s.parserType}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{c?.events ?? 0}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{c?.signals ?? 0}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{c?.last ? `${fmtAge(c.last)} ago` : "none yet"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{s.lastSyncedAt ? `${fmtAge(s.lastSyncedAt)} ago` : "never"}</TableCell>
                  <TableCell className="whitespace-nowrap text-right">
                    <Link href={`/admin/events?source=${s.id}`} className={ACTION}>
                      Events
                    </Link>
                    <Link href={`/admin/sources?edit=${s.id}`} className={ACTION}>
                      Edit
                    </Link>
                    {s.active && status.signedIn && (
                      <form action={telegramSyncSourceAction} className="inline">
                        <input type="hidden" name="sourceId" value={s.id} />
                        <button type="submit" className={cn(ACTION, "mr-0")}>
                          Sync now
                        </button>
                      </form>
                    )}
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
