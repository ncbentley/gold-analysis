import { Send } from "lucide-react";
import { Notice } from "@/components/admin-bits";
import { ImportProgressRefresh } from "@/components/import-progress";
import { PageHeader } from "@/components/page-header";
import { TelegramAccountDialog } from "@/components/telegram-account-dialog";
import { TelegramAccountPanel } from "@/components/telegram-account-panel";
import { TelegramChannelBoard } from "@/components/telegram-channel-board";
import { buildChannelBoard } from "@/lib/channel-board";
import { requireAdmin } from "@/server/auth/guards";
import { secretKeySource } from "@/server/settings";
import { listSources } from "@/server/signals/queries";
import { getStoredWinRates } from "@/server/statistics/service";
import { connectTelegram, listJoinedTelegramChats, telegramStatus, type JoinedChat } from "@/server/telegram";

export const metadata = { title: "Telegram" };

export default async function AdminTelegramPage({ searchParams }: PageProps<"/admin/telegram">) {
  await requireAdmin();
  const sp = await searchParams;
  let status = await telegramStatus();
  const queueOwnsTelegram = process.env.JOBS_WORKER === "off" && Boolean(process.env.QUEUE_URL);
  if (!queueOwnsTelegram && status.signedIn && !status.connected && !status.pending) {
    await Promise.race([connectTelegram(), new Promise((resolve) => setTimeout(resolve, 4000))]);
    status = await telegramStatus();
  }

  let joinedChats: JoinedChat[] = [];
  let listError: string | null = null;
  if (queueOwnsTelegram ? status.signedIn && !status.pending : status.connected) {
    try {
      const listed = await listJoinedTelegramChats();
      joinedChats = listed.chats;
    } catch (err) {
      listError = (err as Error).message;
    }
  }

  const sources = await listSources({ includeInactive: true, includeQa: true });
  const telegramSources = sources.filter((source) => source.sourceType === "telegram" && source.telegramChannelId);
  const winRates = await getStoredWinRates(telegramSources.map((source) => source.id));
  const channels = buildChannelBoard(joinedChats, telegramSources, winRates);

  return (
    <>
      <PageHeader
        icon={Send}
        size="sm"
        title="Telegram"
        description="Move a channel to the right to track it, or back to the left to stop. Nothing is saved until you press Save."
        actions={
          <TelegramAccountDialog signedIn={status.signedIn} connected={status.connected} pending={Boolean(status.pending)} hasError={Boolean(status.lastError)}>
            <TelegramAccountPanel status={status} keySource={secretKeySource()} />
          </TelegramAccountDialog>
        }
      />
      <ImportProgressRefresh active={telegramSources.some((source) => source.importStatus === "queued" || source.importStatus === "importing")} />
      <Notice searchParams={sp} />
      {listError && <p className="mb-4 rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-sm text-loss">{listError}</p>}
      {!status.signedIn && (
        <p className="mb-4 text-sm text-muted-foreground">Sign in from Account to list the channels and groups this account has joined. Channels already tracked stay on the right.</p>
      )}
      <TelegramChannelBoard
        channels={channels}
        canSync={status.signedIn}
        untrackedEmpty={!status.signedIn ? "Sign in from Account to list joined channels." : listError ? "Joined channels could not be loaded." : undefined}
      />
    </>
  );
}
