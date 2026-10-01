import { Check, ChevronRight, Radar } from "lucide-react";
import Link from "next/link";
import { DirectionBadge, RValue, StatusBadge } from "@/components/signal-bits";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtAge, fmtDateTime, fmtEntry, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SignalListItem } from "@/server/presenters";
import { nowMs } from "@/lib/clock";

function Targets({ targets }: { targets: SignalListItem["targets"] }) {
  if (!targets.length) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-x-2.5 gap-y-0.5">
      {targets.map((t) => (
        <span key={t.index} className={cn("inline-flex items-center gap-0.5 font-mono tabular-nums", t.status === "HIT" ? "font-semibold text-win" : "text-foreground/90")}>
          {t.status === "HIT" && <Check className="size-3" strokeWidth={3} />}
          {fmtPrice(t.price)}
        </span>
      ))}
    </span>
  );
}

function Result({ item }: { item: SignalListItem }) {
  if (item.result.locked) return <span className="text-xs text-muted-foreground">Locked</span>;
  if (!item.result.data) return <span className="text-xs text-muted-foreground">{["PENDING", "ACTIVE", "PARTIAL"].includes(item.status) ? "Open" : "—"}</span>;
  return <RValue value={item.result.data.rResult} className="font-semibold" />;
}

function QaTag() {
  return <span className="ml-1.5 rounded border border-glow/40 px-1 text-[10px] font-normal text-muted-foreground">QA</span>;
}

const ROW_EDGE = {
  long: "border-glow/35 group-hover:border-glow/75",
  short: "border-loss/35 group-hover:border-loss/75",
};

export function SignalList({
  items,
  empty,
  now = nowMs(),
  hrefBase = "/signals",
  showSource = true,
}: {
  items: SignalListItem[];
  empty?: React.ReactNode;
  now?: number;
  hrefBase?: string;
  /** The name is whatever the server decided this viewer may see. */
  showSource?: boolean;
}) {
  if (!items.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-glow/30 bg-glow/[0.03] px-6 py-10 text-center text-sm text-muted-foreground">
        <span className="flex size-10 items-center justify-center rounded-xl bg-glow/10 text-[#8db6ff] ring-1 ring-glow/40">
          <Radar className="size-5" />
        </span>
        <div className="max-w-md text-pretty">{empty ?? "No signals match these filters."}</div>
      </div>
    );
  }
  return (
    <>
      <div className="panel hidden rounded-2xl px-2 pb-1 shadow-[0_0_28px_-10px_rgb(47_123_255/0.55)] ring-1 ring-glow/30 md:block">
        <Table className="border-separate border-spacing-y-1.5">
          <TableHeader>
            <TableRow className="border-0 hover:bg-transparent">
              <TableHead>Published</TableHead>
              {showSource && <TableHead>Source</TableHead>}
              <TableHead>Direction</TableHead>
              <TableHead>Entry</TableHead>
              <TableHead>Stop loss</TableHead>
              <TableHead>Targets</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Result</TableHead>
              <TableHead className="w-8 px-0">
                <span className="sr-only">Open</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((s) => {
              const cell = cn(
                "border-y bg-[#081328]/85 transition-colors group-hover:bg-[#0c1b3a] first:rounded-l-xl first:border-l last:rounded-r-xl last:border-r",
                ROW_EDGE[s.direction === "LONG" ? "long" : "short"],
              );
              return (
                <TableRow key={s.id} className="group relative border-0 hover:bg-transparent">
                  <TableCell className={cn(cell, "whitespace-nowrap")}>
                    <Link
                      href={`${hrefBase}/${s.id}`}
                      className="absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      aria-label="Open signal"
                    />
                    <div className="text-sm font-medium">{fmtDateTime(s.signalTime)}</div>
                    <div className="text-[11px] text-muted-foreground">{fmtAge(s.signalTime, now)} ago</div>
                  </TableCell>
                  {showSource && (
                    <TableCell className={cn(cell, "font-medium")}>
                      {s.source.name}
                      {s.source.isQa && <QaTag />}
                    </TableCell>
                  )}
                  <TableCell className={cell}>
                    <DirectionBadge direction={s.direction} />
                    <div className="mt-0.5 text-[11px] text-muted-foreground capitalize">{s.entryType.toLowerCase()}</div>
                  </TableCell>
                  <TableCell className={cn(cell, "font-mono font-semibold tabular-nums")}>{fmtEntry(s.entryMin, s.entryMax)}</TableCell>
                  <TableCell className={cn(cell, "font-mono tabular-nums", s.stopLoss !== null && "text-loss")}>{fmtPrice(s.stopLoss)}</TableCell>
                  <TableCell className={cn(cell, "max-w-56 text-sm")}>
                    <Targets targets={s.targets} />
                  </TableCell>
                  <TableCell className={cell}>
                    <StatusBadge status={s.status} />
                  </TableCell>
                  <TableCell className={cn(cell, "text-right")}>
                    <Result item={s} />
                  </TableCell>
                  <TableCell className={cn(cell, "w-8 px-0 pr-2 text-primary/70 group-hover:text-primary")}>
                    <ChevronRight className="size-4" aria-hidden />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="grid gap-2 md:hidden">
        {items.map((s) => {
          const long = s.direction === "LONG";
          return (
            <Link
              key={s.id}
              href={`${hrefBase}/${s.id}`}
              className={cn(
                "panel relative overflow-hidden rounded-xl py-3 pl-4 pr-3 ring-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary active:bg-glow/10",
                long ? "ring-glow/35 shadow-[0_0_18px_-10px_rgb(47_123_255/0.8)]" : "ring-loss/35 shadow-[0_0_18px_-10px_var(--loss)]",
              )}
            >
              <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", long ? "bg-glow shadow-[0_0_10px_var(--glow)]" : "bg-loss shadow-[0_0_10px_var(--loss)]")} />
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <DirectionBadge direction={s.direction} />
                  {showSource && (
                    <span className="text-sm font-medium">
                      {s.source.name}
                      {s.source.isQa && <QaTag />}
                    </span>
                  )}
                </div>
                <StatusBadge status={s.status} />
              </div>
              <div className="mt-2.5 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-muted-foreground">Entry</div>
                  <div className="font-mono font-semibold tabular-nums">{fmtEntry(s.entryMin, s.entryMax)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Stop loss</div>
                  <div className={cn("font-mono tabular-nums", s.stopLoss !== null && "text-loss")}>{fmtPrice(s.stopLoss)}</div>
                </div>
                <div className="text-right">
                  <div className="text-muted-foreground">Result</div>
                  <Result item={s} />
                </div>
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-glow/15 pt-2 text-[11px] text-muted-foreground">
                <Targets targets={s.targets} />
                <span className="shrink-0">{fmtAge(s.signalTime, now)} ago</span>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
