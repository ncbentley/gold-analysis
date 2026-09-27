import { Check } from "lucide-react";
import Link from "next/link";
import { DirectionBadge, RValue, StatusBadge } from "@/components/signal-bits";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtAge, fmtDateTime, fmtEntry, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SignalListItem } from "@/server/presenters";
import { nowMs } from "@/lib/clock";

function Targets({ targets }: { targets: SignalListItem["targets"] }) {
  if (!targets.length) return <span className="text-muted-foreground">None stated</span>;
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {targets.map((t) => (
        <span key={t.index} className={cn("inline-flex items-center gap-0.5 font-mono tabular-nums", t.status === "HIT" && "text-win")}>
          {t.status === "HIT" && <Check className="size-3" />}
          {fmtPrice(t.price)}
        </span>
      ))}
    </span>
  );
}

function Result({ item }: { item: SignalListItem }) {
  if (item.result.locked) return <span className="text-xs text-muted-foreground">Locked</span>;
  if (!item.result.data) return <span className="text-xs text-muted-foreground">{["PENDING", "ACTIVE", "PARTIAL"].includes(item.status) ? "Open" : "—"}</span>;
  return <RValue value={item.result.data.rResult} />;
}

export function SignalList({
  items,
  empty,
  now = nowMs(),
  hrefBase = "/signals",
}: {
  items: SignalListItem[];
  empty?: React.ReactNode;
  now?: number;
  hrefBase?: string;
}) {
  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        {empty ?? "No signals match these filters."}
      </div>
    );
  }
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/30 hover:bg-muted/30">
              <TableHead>Published</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Direction</TableHead>
              <TableHead>Entry</TableHead>
              <TableHead>Stop</TableHead>
              <TableHead>Targets</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((s) => (
              <TableRow key={s.id} className="group relative">
                <TableCell className="whitespace-nowrap">
                  <Link href={`${hrefBase}/${s.id}`} className="absolute inset-0" aria-label={`Open signal from ${s.source.name}`} />
                  <div className="text-sm">{fmtDateTime(s.signalTime)}</div>
                  <div className="text-[11px] text-muted-foreground">{fmtAge(s.signalTime, now)} ago</div>
                </TableCell>
                <TableCell className="font-medium">
                  {s.source.name}
                  {s.source.isQa && <span className="ml-1.5 rounded border px-1 text-[10px] font-normal text-muted-foreground">QA</span>}
                </TableCell>
                <TableCell>
                  <DirectionBadge direction={s.direction} />
                  <div className="text-[11px] text-muted-foreground capitalize">{s.entryType.toLowerCase()}</div>
                </TableCell>
                <TableCell className="font-mono tabular-nums">{fmtEntry(s.entryMin, s.entryMax)}</TableCell>
                <TableCell className="font-mono tabular-nums">{fmtPrice(s.stopLoss)}</TableCell>
                <TableCell className="max-w-56 text-sm">
                  <Targets targets={s.targets} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={s.status} />
                </TableCell>
                <TableCell className="text-right">
                  <Result item={s} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="grid gap-2 md:hidden">
        {items.map((s) => (
          <Link key={s.id} href={`${hrefBase}/${s.id}`} className="rounded-lg border bg-card/60 p-3 active:bg-muted/40">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <DirectionBadge direction={s.direction} />
                <span className="text-sm font-medium">
                  {s.source.name}
                  {s.source.isQa && <span className="ml-1.5 rounded border px-1 text-[10px] font-normal text-muted-foreground">QA</span>}
                </span>
              </div>
              <StatusBadge status={s.status} />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground">Entry</div>
                <div className="font-mono">{fmtEntry(s.entryMin, s.entryMax)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Stop</div>
                <div className="font-mono">{fmtPrice(s.stopLoss)}</div>
              </div>
              <div className="text-right">
                <div className="text-muted-foreground">Result</div>
                <Result item={s} />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <Targets targets={s.targets} />
              <span>{fmtAge(s.signalTime, now)} ago</span>
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
