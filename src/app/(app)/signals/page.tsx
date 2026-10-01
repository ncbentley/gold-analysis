import { ChartCandlestick, ChevronLeft, ChevronRight, CircleCheck, Radio, SlidersHorizontal } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { LockedPanel } from "@/components/locked";
import { PageHeader } from "@/components/page-header";
import { SignalFilters } from "@/components/signal-filters";
import { SignalList } from "@/components/signal-list";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { can, lowestTierWith } from "@/server/entitlements/access";
import { getViewer } from "@/server/entitlements/service";
import { sourceDisplayName } from "@/server/presenters";
import { listSignalsForViewer, listSignalTypes, listSources, parseSignalFilters } from "@/server/signals/queries";

export const metadata: Metadata = { title: "Live signals" };
const PAGE_SIZE = 25;

const FEATURES = [
  { icon: ChartCandlestick, label: "Replayed on 1-minute XAU/USD bars" },
  { icon: CircleCheck, label: "Targets marked as they are hit" },
  { icon: SlidersHorizontal, label: "Filter by status, direction and date" },
];

export default async function SignalsPage({ searchParams }: PageProps<"/signals">) {
  const viewer = await getViewer();
  const sp = await searchParams;
  if (!can(viewer.access, "signals.core")) {
    return (
      <>
        <PageHeader title="Live signals" icon={Radio} description="Gold signals from tracked sources, with every level replayed against market data." />
        <LockedPanel feature="signals.core" requiredTier={lowestTierWith("signals.core", viewer.config)} title="Signals are available to members" userId={viewer.user?.id} />
      </>
    );
  }
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const filters = parseSignalFilters(sp);
  const [result, signalTypes, sources] = await Promise.all([
    listSignalsForViewer(viewer, filters, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    listSignalTypes(),
    listSources({ includeQa: viewer.access.isAdmin }),
  ]);
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const pageHref = (p: number) => {
    const q = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
    q.set("page", String(p));
    return `/signals?${q.toString()}`;
  };

  return (
    <>
      <PageHeader
        title="Live signals"
        icon={Radio}
        features={FEATURES}
        description={
          result.historyCutoff
            ? `Showing signals since ${fmtDate(result.historyCutoff)} (${viewer.access.historyDays}-day history on your plan).`
            : "Full signal history."
        }
      />
      <div className="mb-4">
        <Suspense>
          <SignalFilters
            sources={sources.map((source) => ({ value: source.id, label: sourceDisplayName(source, viewer.access) }))}
            signalTypes={signalTypes}
            advanced={can(viewer.access, "filters.advanced")}
            search={can(viewer.access, "search.history")}
          />
        </Suspense>
      </div>
      <div className="mb-2 px-1 text-xs text-muted-foreground">
        <span className="font-mono font-semibold text-foreground tabular-nums">{result.total}</span> signal{result.total === 1 ? "" : "s"}
      </div>
      <SignalList items={result.items} />
      {pages > 1 && (
        <nav aria-label="Pagination" className="panel mt-4 flex items-center justify-between gap-2 rounded-xl p-2 text-sm ring-1 ring-glow/25 sm:justify-end">
          <Link href={pageHref(page - 1)} aria-disabled={page <= 1} className={cn(buttonVariants({ variant: "outline", size: "sm" }), page <= 1 && "pointer-events-none opacity-50")}>
            <ChevronLeft /> Prev
          </Link>
          <span className="px-2 text-muted-foreground">
            Page <span className="font-mono font-semibold text-primary tabular-nums">{page}</span> of <span className="font-mono tabular-nums text-foreground">{pages}</span>
          </span>
          <Link href={pageHref(page + 1)} aria-disabled={page >= pages} className={cn(buttonVariants({ variant: "outline", size: "sm" }), page >= pages && "pointer-events-none opacity-50")}>
            Next <ChevronRight />
          </Link>
        </nav>
      )}
    </>
  );
}
