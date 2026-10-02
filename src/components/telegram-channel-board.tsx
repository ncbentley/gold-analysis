"use client";

import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Loader2, Search, Star } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { saveTelegramTrackingAction, starTelegramChannelAction, telegramSyncSourceAction } from "@/app/actions/admin";
import { StateBadge } from "@/components/admin-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtPct } from "@/lib/format";
import {
  matchesChannelSearch,
  matchesTrackedColumn,
  parseWinRatePercent,
  sortChannels,
  trackingChanges,
  type BoardChannel,
  type ChannelSort,
  type ChannelSortKey,
} from "@/lib/channel-board";
import { cn } from "@/lib/utils";

const ACTION = "rounded text-xs font-medium text-[#8db6ff] outline-none hover:text-primary hover:underline focus-visible:ring-2 focus-visible:ring-ring";
const NAME_SORT: ChannelSort = { key: "channel", dir: "asc" };

function toggleSort(current: ChannelSort, key: ChannelSortKey): ChannelSort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "winRate" ? "desc" : "asc" };
}

function chatPayload(channel: BoardChannel) {
  return JSON.stringify({
    id: channel.id,
    accessHash: channel.accessHash,
    username: channel.username,
    title: channel.title,
    kind: channel.kind,
  });
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 data-icon="inline-start" className="animate-spin motion-reduce:animate-none" /> : null}
      {pending ? "Saving" : "Save"}
    </Button>
  );
}

function SearchField({ id, value, onChange, label }: { id: string; value: string; onChange: (value: string) => void; label: string }) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input id={id} type="search" value={value} onChange={(event) => onChange(event.target.value)} placeholder="Name, handle, or link" aria-label={label} autoComplete="off" className="h-8 pl-8 text-sm" />
    </div>
  );
}

function Handle({ channel }: { channel: BoardChannel }) {
  if (!channel.username || !channel.link) return <span className="text-xs text-muted-foreground">private</span>;
  return (
    <a href={channel.link} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="font-mono text-xs text-muted-foreground hover:text-primary hover:underline">
      @{channel.username}
    </a>
  );
}

export function TelegramChannelBoard({ channels, canSync, untrackedEmpty }: { channels: BoardChannel[]; canSync: boolean; untrackedEmpty?: string }) {
  const [flipped, setFlipped] = useState<Set<string>>(() => new Set());
  const [leftQuery, setLeftQuery] = useState("");
  const [rightQuery, setRightQuery] = useState("");
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [minRate, setMinRate] = useState("");
  const [maxRate, setMaxRate] = useState("");
  const [leftSort, setLeftSort] = useState<ChannelSort>(NAME_SORT);
  const [rightSort, setRightSort] = useState<ChannelSort>(NAME_SORT);

  const rightFilter = useMemo(
    () => ({
      query: rightQuery,
      errorsOnly,
      minWinRate: parseWinRatePercent(minRate),
      maxWinRate: parseWinRatePercent(maxRate),
    }),
    [rightQuery, errorsOnly, minRate, maxRate],
  );
  const boundsInverted = rightFilter.minWinRate !== null && rightFilter.maxWinRate !== null && rightFilter.minWinRate > rightFilter.maxWinRate;

  const trackedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const channel of channels) {
      const on = flipped.has(channel.id) ? !channel.tracked : channel.tracked;
      if (on) ids.add(channel.id);
    }
    return ids;
  }, [channels, flipped]);
  const leftAll = channels.filter((channel) => !trackedIds.has(channel.id));
  const rightAll = channels.filter((channel) => trackedIds.has(channel.id));
  const leftShown = sortChannels(
    leftAll.filter((channel) => matchesChannelSearch(channel, leftQuery)),
    leftSort,
  );
  const rightShown = sortChannels(
    rightAll.filter((channel) => matchesTrackedColumn(channel, rightFilter)),
    rightSort,
  );
  const { add, remove, dirty } = trackingChanges(channels, trackedIds);
  const hiddenAdds = add.filter((channel) => !matchesTrackedColumn(channel, rightFilter)).length;
  const hiddenRemoves = remove.filter((channel) => !matchesChannelSearch(channel, leftQuery)).length;
  const hidden = hiddenAdds + hiddenRemoves;

  function move(id: string) {
    setFlipped((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className={cn("grid gap-4 lg:grid-cols-2", dirty && "pb-24")}>
      <Column
        title="Not tracked"
        total={leftAll.length}
        shown={leftShown.length}
        filtered={leftQuery.trim() !== ""}
        empty={leftAll.length === 0 ? (untrackedEmpty ?? "Nothing waiting. Joined channels that are not tracked show up here.") : "No channels match this search."}
        filters={<SearchField id="untracked-search" value={leftQuery} onChange={setLeftQuery} label="Search untracked channels" />}
        body={<ChannelTable channels={leftShown} trackedSide={false} flipped={flipped} onMove={move} canSync={canSync} sort={leftSort} onSort={(key) => setLeftSort((current) => toggleSort(current, key))} />}
      />

      <Column
        title="Tracked"
        total={rightAll.length}
        shown={rightShown.length}
        filtered={rightQuery.trim() !== "" || errorsOnly || minRate.trim() !== "" || maxRate.trim() !== ""}
        empty={rightAll.length === 0 ? "No tracked channels. Move one over from the left, then save." : boundsInverted ? "Minimum win rate is higher than the maximum." : "No channels match this filter."}
        filters={
          <div className="space-y-2">
            <SearchField id="tracked-search" value={rightQuery} onChange={setRightQuery} label="Search tracked channels" />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <label className="flex items-center gap-1.5 text-xs font-medium">
                <input type="checkbox" checked={errorsOnly} onChange={(event) => setErrorsOnly(event.target.checked)} className="size-3.5 accent-primary" />
                Errors
              </label>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span>Win rate</span>
                <Input value={minRate} onChange={(event) => setMinRate(event.target.value)} inputMode="decimal" placeholder="Min" aria-label="Minimum win rate percent" className="h-8 w-16 px-2 font-mono text-sm tabular-nums" />
                <span aria-hidden>–</span>
                <Input value={maxRate} onChange={(event) => setMaxRate(event.target.value)} inputMode="decimal" placeholder="Max" aria-label="Maximum win rate percent" className="h-8 w-16 px-2 font-mono text-sm tabular-nums" />
                <span>%</span>
              </div>
            </div>
          </div>
        }
        body={<ChannelTable channels={rightShown} trackedSide flipped={flipped} onMove={move} canSync={canSync} sort={rightSort} onSort={(key) => setRightSort((current) => toggleSort(current, key))} />}
      />

      {dirty && (
        <form action={saveTelegramTrackingAction} className="fixed bottom-6 left-1/2 z-40 flex w-[min(40rem,calc(100%-2rem))] -translate-x-1/2 items-center justify-between gap-3 rounded-2xl border border-primary/50 bg-[#0a1428]/95 px-3 py-2.5 shadow-[0_0_28px_-6px_rgb(245_197_66/0.75)] ring-1 ring-primary/40 backdrop-blur-md lg:left-[calc(50%+8rem)]">
          {add.map((channel) => (
            <input key={channel.id} type="hidden" name="add" value={chatPayload(channel)} />
          ))}
          {remove.map((channel) => (
            <input key={channel.id} type="hidden" name="remove" value={channel.sourceId ?? ""} />
          ))}
          <div className="min-w-0 text-sm">
            <div className="font-semibold">
              {[add.length > 0 && `${add.length} to track`, remove.length > 0 && `${remove.length} to stop`].filter(Boolean).join(" · ")}
            </div>
            {hidden > 0 && <div className="text-xs text-muted-foreground">{hidden} of those {hidden === 1 ? "is" : "are"} hidden by a filter</div>}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setFlipped(new Set())}>
              Discard
            </Button>
            <SaveButton />
          </div>
        </form>
      )}
    </div>
  );
}

function Column({
  title,
  total,
  shown,
  filtered,
  empty,
  filters,
  body,
}: {
  title: string;
  total: number;
  shown: number;
  filtered: boolean;
  empty: string;
  filters: React.ReactNode;
  body: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-xl bg-[#081226] ring-1 ring-primary/30">
      <div className="flex items-baseline justify-between gap-3 border-b border-glow/20 px-3 py-2.5">
        <h2 className="font-heading text-base font-bold tracking-tight">{title}</h2>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">{filtered ? `${shown} of ${total}` : total}</span>
      </div>
      <div className="border-b border-glow/15 px-3 py-2.5">{filters}</div>
      <div className="min-h-48 flex-1">{shown === 0 ? <p className="px-3 py-8 text-center text-sm text-muted-foreground">{empty}</p> : body}</div>
    </section>
  );
}

function StarButton({ channel }: { channel: BoardChannel }) {
  const { pending } = useFormStatus();
  const on = channel.starred;
  return (
    <button
      type="submit"
      disabled={pending}
      aria-pressed={on}
      aria-label={on ? `Unstar ${channel.title}` : `Star ${channel.title} for market direction`}
      className="inline-flex size-7 items-center justify-center rounded-lg text-primary outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
    >
      <Star className={cn("size-4", on && "fill-current")} />
    </button>
  );
}

function StarForm({ channel }: { channel: BoardChannel }) {
  return (
    <form action={starTelegramChannelAction} onClick={(event) => event.stopPropagation()}>
      {channel.sourceId ? <input type="hidden" name="sourceId" value={channel.sourceId} /> : <input type="hidden" name="chat" value={chatPayload(channel)} />}
      <input type="hidden" name="starred" value={channel.starred ? "0" : "1"} />
      <StarButton channel={channel} />
    </form>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  align,
  onSort,
  className,
}: {
  label: string;
  sortKey: ChannelSortKey;
  sort: ChannelSort;
  align: "left" | "right";
  onSort: (key: ChannelSortKey) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <th aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={cn("px-3 py-2 font-semibold", align === "right" && "text-right", className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
        {active ? (sort.dir === "asc" ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />) : null}
      </button>
    </th>
  );
}

function ChannelTable({
  channels,
  trackedSide,
  flipped,
  onMove,
  canSync,
  sort,
  onSort,
}: {
  channels: BoardChannel[];
  trackedSide: boolean;
  flipped: Set<string>;
  onMove: (id: string) => void;
  canSync: boolean;
  sort: ChannelSort;
  onSort: (key: ChannelSortKey) => void;
}) {
  if (channels.length === 0) return null;
  return (
    <div className="max-h-[32rem] overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-[#081226]">
          <tr className="border-b border-glow/20 text-left text-xs font-semibold text-muted-foreground">
            <SortHeader label="Channel" sortKey="channel" sort={sort} align="left" onSort={onSort} />
            {trackedSide && <SortHeader label="Win rate" sortKey="winRate" sort={sort} align="right" onSort={onSort} className="w-24" />}
            <th className="w-12 px-2 py-2">
              <span className="sr-only">Market direction</span>
            </th>
            <th className="w-12 px-2 py-2">
              <span className="sr-only">{trackedSide ? "Stop tracking" : "Track"}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {channels.map((channel) => {
            const pending = flipped.has(channel.id);
            const savedHere = !pending && (channel.tracked || channel.starred);
            const label = trackedSide ? `Stop tracking ${channel.title}` : `Track ${channel.title}`;
            return (
              <tr
                key={channel.id}
                onClick={() => onMove(channel.id)}
                className={cn(
                  "cursor-pointer border-b border-glow/15 transition-colors last:border-0 hover:bg-glow/[0.07]",
                  pending && trackedSide && "bg-primary/10",
                  pending && !trackedSide && "bg-loss/10",
                  channel.sourceId && !channel.active && "opacity-60",
                )}
              >
                <td className="px-3 py-2.5 align-middle">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold">{channel.title}</span>
                    {channel.starred && <Badge variant="secondary">Direction</Badge>}
                    {channel.isQa && <Badge variant="secondary">QA</Badge>}
                    {channel.sourceId && !channel.active && <Badge variant="outline">disabled</Badge>}
                    {pending && <span className="text-[11px] font-medium text-primary">{trackedSide ? "will track" : "will stop"}</span>}
                    {channel.importStatus && (trackedSide || channel.starred) && <StateBadge state={channel.importStatus} />}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Handle channel={channel} />
                    <span className="text-[11px] text-muted-foreground">{channel.kind === "group" ? "Group" : "Channel"}</span>
                    {(trackedSide || channel.starred) && channel.sourceId && savedHere && (
                      <Link href={`/admin/events?source=${channel.sourceId}`} onClick={(event) => event.stopPropagation()} className={ACTION}>
                        Events
                      </Link>
                    )}
                    {(trackedSide || channel.starred) && canSync && channel.sourceId && channel.active && savedHere && (
                      <form action={telegramSyncSourceAction} className="inline" onClick={(event) => event.stopPropagation()}>
                        <input type="hidden" name="sourceId" value={channel.sourceId} />
                        <button type="submit" className={ACTION}>
                          Sync now
                        </button>
                      </form>
                    )}
                  </div>
                  {trackedSide && channel.error && <div className="mt-1 max-w-md text-xs text-loss">{channel.error}</div>}
                </td>
                {trackedSide && <td className="px-3 py-2.5 text-right font-mono text-xs tabular-nums">{fmtPct(channel.winRate)}</td>}
                <td className="px-2 py-2.5 text-right">
                  <StarForm channel={channel} />
                </td>
                <td className="px-2 py-2.5 text-right">
                  <button
                    type="button"
                    aria-label={label}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMove(channel.id);
                    }}
                    className="inline-flex size-7 items-center justify-center rounded-lg text-primary outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {trackedSide ? <ArrowLeft className="size-4" /> : <ArrowRight className="size-4" />}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
