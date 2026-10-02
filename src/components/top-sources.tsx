"use client";

import { Popover } from "@base-ui/react/popover";
import { ChevronDown, ChevronUp, ChevronsUpDown, ListFilter, Lock } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { RValue } from "@/components/signal-bits";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtPct } from "@/lib/format";
import {
  boundsInverted,
  filterActive,
  interpretBound,
  matchesTopSourceRow,
  sortTopSources,
  toggleTopSourceSort,
  type NumericBounds,
  type TopSourceNumericFilter,
  type TopSourceSort,
  type TopSourceSortKey,
} from "@/lib/top-source-filters";
import { cn } from "@/lib/utils";
import { TOP_SOURCES_MIN_TRADES } from "@/server/statistics/compute";

export type TopSourceRow = {
  sourceId: string;
  name: string;
  closedTrades: number;
  metrics: { winRate: number | null; expectancy: number | null } | null;
};

type BoundDraft = { min: string; max: string };

const EMPTY_DRAFT: BoundDraft = { min: "", max: "" };

function Rank({ n }: { n: number }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full font-heading text-sm font-extrabold",
        n === 1
          ? "gold-fill shadow-[0_0_14px_-3px_rgb(245_197_66/0.7)]"
          : n <= 3
            ? "bg-primary/10 text-primary ring-1 ring-primary/55"
            : "bg-glow/10 text-[#8db6ff] ring-1 ring-glow/45",
      )}
    >
      {n}
    </span>
  );
}

function toBounds(draft: BoundDraft, interpret: (raw: string) => { value: number | null; invalid: boolean }): NumericBounds & { invalid: boolean } {
  const min = interpret(draft.min);
  const max = interpret(draft.max);
  return { min: min.value, max: max.value, invalid: min.invalid || max.invalid };
}

function ColumnFilter({
  label,
  unit,
  draft,
  onChange,
  interpret,
}: {
  label: string;
  unit?: string;
  draft: BoundDraft;
  onChange: (next: BoundDraft) => void;
  interpret: (raw: string) => { value: number | null; invalid: boolean };
}) {
  const active = draft.min.trim() !== "" || draft.max.trim() !== "";
  const bounds = toBounds(draft, interpret);
  return (
    <Popover.Root>
      <Popover.Trigger
        type="button"
        aria-label={`Filter ${label}`}
        className={cn(
          "inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-glow/15 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-glow/15 aria-expanded:text-foreground",
          active && "text-primary",
        )}
      >
        <ListFilter className="size-3.5" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner align="end" side="bottom" sideOffset={6} className="isolate z-50 outline-none">
          <Popover.Popup className="w-56 origin-(--transform-origin) rounded-lg bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-primary/40 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
            <div className="mb-2 flex items-center justify-between gap-2">
              <Popover.Title className="text-xs font-semibold">{label}</Popover.Title>
              {active && (
                <button
                  type="button"
                  onClick={() => onChange(EMPTY_DRAFT)}
                  className="rounded text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Input
                value={draft.min}
                onChange={(event) => onChange({ ...draft, min: event.target.value })}
                inputMode="decimal"
                placeholder="Min"
                aria-label={`Minimum ${label}`}
                autoComplete="off"
                className="h-8 px-2 font-mono text-sm tabular-nums"
              />
              <span aria-hidden className="text-muted-foreground">
                –
              </span>
              <Input
                value={draft.max}
                onChange={(event) => onChange({ ...draft, max: event.target.value })}
                inputMode="decimal"
                placeholder="Max"
                aria-label={`Maximum ${label}`}
                autoComplete="off"
                className="h-8 px-2 font-mono text-sm tabular-nums"
              />
              {unit && <span className="shrink-0 text-xs text-muted-foreground">{unit}</span>}
            </div>
            {bounds.invalid && <p className="mt-2 text-xs text-loss">Enter a number.</p>}
            {boundsInverted(bounds) && <p className="mt-2 text-xs text-loss">Minimum is higher than the maximum.</p>}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function SortButton({ label, sortKey, sort, onSort }: { label: string; sortKey: TopSourceSortKey; sort: TopSourceSort; onSort: (key: TopSourceSortKey) => void }) {
  const active = sort.key === sortKey;
  const Icon = active ? (sort.dir === "asc" ? ChevronUp : ChevronDown) : ChevronsUpDown;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn(
        "inline-flex items-center gap-0.5 rounded outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        active && "text-foreground",
      )}
    >
      {label}
      <Icon className={cn("size-3.5", !active && "opacity-50")} />
    </button>
  );
}

function NumericHead({
  label,
  sortKey,
  unit,
  draft,
  onChange,
  interpret,
  sort,
  onSort,
}: {
  label: string;
  sortKey: TopSourceSortKey;
  unit?: string;
  draft: BoundDraft;
  onChange: (next: BoundDraft) => void;
  interpret: (raw: string) => { value: number | null; invalid: boolean };
  sort: TopSourceSort;
  onSort: (key: TopSourceSortKey) => void;
}) {
  const active = sort.key === sortKey;
  return (
    <TableHead aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className="text-right">
      <span className="inline-flex items-center gap-0.5">
        <SortButton label={label} sortKey={sortKey} sort={sort} onSort={onSort} />
        <ColumnFilter label={label} unit={unit} draft={draft} onChange={onChange} interpret={interpret} />
      </span>
    </TableHead>
  );
}

export function TopSources({
  rows,
  eligibleCount,
  sourceCount,
  lockedHref,
  hrefBase,
}: {
  rows: TopSourceRow[];
  eligibleCount: number;
  sourceCount: number;
  lockedHref?: string;
  /** Links each name to its source page. Left off for anonymous visitors. */
  hrefBase?: string;
}) {
  const [closedTrades, setClosedTrades] = useState<BoundDraft>(EMPTY_DRAFT);
  const [winRate, setWinRate] = useState<BoundDraft>(EMPTY_DRAFT);
  const [expectancy, setExpectancy] = useState<BoundDraft>(EMPTY_DRAFT);
  const [sort, setSort] = useState<TopSourceSort>({ key: "expectancy", dir: "desc" });

  const filter = useMemo<TopSourceNumericFilter>(() => {
    const trades = toBounds(closedTrades, interpretBound);
    const rate = toBounds(winRate, interpretBound);
    const expected = toBounds(expectancy, interpretBound);
    return {
      closedTrades: { min: trades.min, max: trades.max },
      winRatePercent: { min: rate.min, max: rate.max },
      expectancy: { min: expected.min, max: expected.max },
    };
  }, [closedTrades, winRate, expectancy]);

  const filtering = filterActive(filter);
  const inverted = boundsInverted(filter.closedTrades) || boundsInverted(filter.winRatePercent) || boundsInverted(filter.expectancy);
  const ranked = rows.map((row, index) => ({ row, rank: index + 1 }));
  const shown = sortTopSources(
    ranked.filter(({ row }) => matchesTopSourceRow(row, filter)),
    sort,
  );
  const draftsActive = [closedTrades, winRate, expectancy].some((draft) => draft.min.trim() !== "" || draft.max.trim() !== "");
  function onSort(key: TopSourceSortKey) {
    setSort((current) => toggleTopSourceSort(current, key));
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-glow/30 bg-glow/[0.03] p-8 text-center text-sm text-muted-foreground">
        Rankings appear once a source has {TOP_SOURCES_MIN_TRADES} closed trades.
      </div>
    );
  }
  const locked = shown.some(({ row }) => !row.metrics);
  return (
    <div className="panel overflow-hidden rounded-xl shadow-[0_0_24px_-12px_rgb(47_123_255/0.6)] ring-1 ring-glow/30">
      <Table>
        <TableHeader>
          <TableRow className="bg-black/20 hover:bg-black/20">
            <TableHead aria-sort={sort.key === "rank" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className="w-16">
              <SortButton label="Rank" sortKey="rank" sort={sort} onSort={onSort} />
            </TableHead>
            <TableHead aria-sort={sort.key === "source" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
              <SortButton label="Source" sortKey="source" sort={sort} onSort={onSort} />
            </TableHead>
            <NumericHead label="Closed trades" sortKey="closedTrades" draft={closedTrades} onChange={setClosedTrades} interpret={interpretBound} sort={sort} onSort={onSort} />
            <NumericHead label="Win rate" sortKey="winRate" unit="%" draft={winRate} onChange={setWinRate} interpret={interpretBound} sort={sort} onSort={onSort} />
            <NumericHead label="Expectancy" sortKey="expectancy" unit="R" draft={expectancy} onChange={setExpectancy} interpret={interpretBound} sort={sort} onSort={onSort} />
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                {inverted ? "A minimum is higher than its maximum." : "No sources match these filters."}
              </TableCell>
            </TableRow>
          ) : (
            shown.map(({ row: r, rank }) => (
              <TableRow key={r.sourceId}>
                <TableCell>
                  <Rank n={rank} />
                </TableCell>
                <TableCell className="font-medium text-foreground/90">
                  {hrefBase ? (
                    <Link href={`${hrefBase}/${r.sourceId}`} className="rounded outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                      {r.name}
                    </Link>
                  ) : (
                    r.name
                  )}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">{r.closedTrades}</TableCell>
                {r.metrics ? (
                  <>
                    <TableCell className={cn("text-right font-mono tabular-nums", rank === 1 && "gold-text font-bold")}>{fmtPct(r.metrics.winRate)}</TableCell>
                    <TableCell className="text-right">
                      <RValue value={r.metrics.expectancy} className="font-semibold" />
                    </TableCell>
                  </>
                ) : (
                  <TableCell colSpan={2} className="text-right text-muted-foreground">
                    <Lock className="ml-auto size-4" aria-label="Locked" />
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-glow/15 bg-black/20 px-3 py-2.5 text-xs text-muted-foreground">
        <span>
          Ranked by expectancy among the {eligibleCount} of {sourceCount} sources with at least {TOP_SOURCES_MIN_TRADES} closed trades.
          {filtering ? ` Showing ${shown.length} of ${rows.length}.` : ""}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {draftsActive && (
            <button
              type="button"
              onClick={() => {
                setClosedTrades(EMPTY_DRAFT);
                setWinRate(EMPTY_DRAFT);
                setExpectancy(EMPTY_DRAFT);
              }}
              className="rounded font-semibold text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Clear filters
            </button>
          )}
          {locked && lockedHref && (
            <Link href={lockedHref} className="font-semibold text-primary hover:underline">
              Win rate and expectancy are included with Gold
            </Link>
          )}
        </span>
      </div>
    </div>
  );
}
