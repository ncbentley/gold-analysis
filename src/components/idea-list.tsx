import { ChevronRight, Layers } from "lucide-react";
import Link from "next/link";
import { DirectionBadge } from "@/components/signal-bits";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtAge, fmtDateTime, fmtEntry, fmtPrice } from "@/lib/format";
import { nowMs } from "@/lib/clock";
import { cn } from "@/lib/utils";
import type { IdeaPhase } from "@/server/ideas/phase";

export interface IdeaListItem {
  id: string;
  direction: "LONG" | "SHORT";
  entryMin: number;
  entryMax: number;
  stopLoss: number | null;
  targets: number[];
  sourceCount: number;
  newestSignalAt: string;
  phase: IdeaPhase;
  close?: boolean;
}

const PHASE_LABEL: Record<IdeaPhase, string> = {
  available: "Available",
  "playing-out": "Playing out",
  history: "History",
};

const PHASE_STYLE: Record<IdeaPhase, string> = {
  available: "border-glow/50 bg-glow/10 text-[#8db6ff]",
  "playing-out": "border-primary/50 bg-primary/10 text-primary",
  history: "border-border bg-muted/60 text-muted-foreground",
};

function PhaseBadge({ phase }: { phase: IdeaPhase }) {
  return (
    <Badge variant="outline" className={cn("rounded-md font-semibold", PHASE_STYLE[phase])}>
      {PHASE_LABEL[phase]}
    </Badge>
  );
}

function CloseBadge() {
  return (
    <Badge variant="outline" className="rounded-md border-loss/60 bg-loss/10 font-semibold text-loss">
      CLOSE
    </Badge>
  );
}

function StatusBadges({ idea }: { idea: IdeaListItem }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {idea.close ? <CloseBadge /> : <PhaseBadge phase={idea.phase} />}
    </span>
  );
}

function Targets({ targets }: { targets: number[] }) {
  if (!targets.length) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-wrap gap-x-2.5 gap-y-0.5">
      {targets.map((price, index) => (
        <span key={index} className="font-mono tabular-nums text-foreground/90">
          {fmtPrice(price)}
        </span>
      ))}
    </span>
  );
}

function sourceLabel(count: number) {
  return `${count} source${count === 1 ? "" : "s"}`;
}

const ROW_EDGE = {
  long: "border-glow/35 group-hover:border-glow/75",
  short: "border-loss/35 group-hover:border-loss/75",
};

export function IdeaList({ items, empty, now = nowMs() }: { items: IdeaListItem[]; empty?: React.ReactNode; now?: number }) {
  if (!items.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-glow/30 bg-glow/[0.03] px-6 py-10 text-center text-sm text-muted-foreground">
        <span className="flex size-10 items-center justify-center rounded-xl bg-glow/10 text-[#8db6ff] ring-1 ring-glow/40">
          <Layers className="size-5" />
        </span>
        <div className="max-w-md text-pretty">{empty ?? "No ideas in this window."}</div>
      </div>
    );
  }
  return (
    <>
      <div className="panel hidden rounded-2xl px-2 pb-1 shadow-[0_0_28px_-10px_rgb(47_123_255/0.55)] ring-1 ring-glow/30 md:block">
        <Table className="border-separate border-spacing-y-1.5">
          <TableHeader>
            <TableRow className="border-0 hover:bg-transparent">
              <TableHead>Newest</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>Entry</TableHead>
              <TableHead>Stop loss</TableHead>
              <TableHead>Targets</TableHead>
              <TableHead>Sources</TableHead>
              <TableHead>Phase</TableHead>
              <TableHead className="w-8 px-0">
                <span className="sr-only">Open</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((idea) => {
              const cell = cn(
                "border-y bg-[#081328]/85 transition-colors group-hover:bg-[#0c1b3a] first:rounded-l-xl first:border-l last:rounded-r-xl last:border-r",
                ROW_EDGE[idea.direction === "LONG" ? "long" : "short"],
              );
              return (
                <TableRow key={idea.id} className="group relative border-0 hover:bg-transparent">
                  <TableCell className={cn(cell, "whitespace-nowrap")}>
                    <Link
                      href={`/ideas/${idea.id}`}
                      className="absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      aria-label="Open idea"
                    />
                    <div className="text-sm font-medium">{fmtDateTime(idea.newestSignalAt)}</div>
                    <div className="text-[11px] text-muted-foreground">{fmtAge(idea.newestSignalAt, now)} ago</div>
                  </TableCell>
                  <TableCell className={cell}>
                    <DirectionBadge direction={idea.direction} />
                  </TableCell>
                  <TableCell className={cn(cell, "font-mono font-semibold tabular-nums")}>{fmtEntry(idea.entryMin, idea.entryMax)}</TableCell>
                  <TableCell className={cn(cell, "font-mono tabular-nums", idea.stopLoss !== null && "text-loss")}>{fmtPrice(idea.stopLoss)}</TableCell>
                  <TableCell className={cn(cell, "max-w-56 text-sm")}>
                    <Targets targets={idea.targets} />
                  </TableCell>
                  <TableCell className={cn(cell, "tabular-nums")}>{sourceLabel(idea.sourceCount)}</TableCell>
                  <TableCell className={cell}>
                    <StatusBadges idea={idea} />
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
        {items.map((idea) => {
          const long = idea.direction === "LONG";
          return (
            <Link
              key={idea.id}
              href={`/ideas/${idea.id}`}
              className={cn(
                "panel relative overflow-hidden rounded-xl py-3 pl-4 pr-3 ring-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary active:bg-glow/10",
                long ? "ring-glow/35 shadow-[0_0_18px_-10px_rgb(47_123_255/0.8)]" : "ring-loss/35 shadow-[0_0_18px_-10px_var(--loss)]",
              )}
            >
              <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", long ? "bg-glow shadow-[0_0_10px_var(--glow)]" : "bg-loss shadow-[0_0_10px_var(--loss)]")} />
              <div className="flex items-center justify-between gap-2">
                <DirectionBadge direction={idea.direction} />
                <StatusBadges idea={idea} />
              </div>
              <div className="mt-2.5 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <div className="text-muted-foreground">Entry</div>
                  <div className="font-mono font-semibold tabular-nums">{fmtEntry(idea.entryMin, idea.entryMax)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Stop loss</div>
                  <div className={cn("font-mono tabular-nums", idea.stopLoss !== null && "text-loss")}>{fmtPrice(idea.stopLoss)}</div>
                </div>
                <div className="text-right">
                  <div className="text-muted-foreground">Sources</div>
                  <div className="font-semibold tabular-nums">{idea.sourceCount}</div>
                </div>
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-3 border-t border-glow/15 pt-2 text-[11px] text-muted-foreground">
                <Targets targets={idea.targets} />
                <span className="shrink-0">{fmtAge(idea.newestSignalAt, now)} ago</span>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
