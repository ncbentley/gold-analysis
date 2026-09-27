import { ChevronLeft, ChevronRight } from "lucide-react";
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
import { listSignalsForViewer, listSignalTypes, listSources, parseSignalFilters } from "@/server/signals/queries";

export const metadata: Metadata = { title: "Signals" };
const PAGE_SIZE = 25;

export default async function SignalsPage({ searchParams }: PageProps<"/signals">) {
  const viewer = await getViewer();
  const sp = await searchParams;
  if (!can(viewer.access, "signals.core")) {
    return (
      <>
        <PageHeader title="Signals" />
        <LockedPanel feature="signals.core" requiredTier={lowestTierWith("signals.core", viewer.config)} title="Signals are available to members" userId={viewer.user?.id} />
      </>
    );
  }
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const filters = parseSignalFilters(sp);
  const [result, sources, signalTypes] = await Promise.all([
    listSignalsForViewer(viewer, filters, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
    listSources({ includeQa: viewer.access.isAdmin }),
    listSignalTypes(),
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
        title="Signals"
        description={
          result.historyCutoff
            ? `Showing signals since ${fmtDate(result.historyCutoff)} (${viewer.access.historyDays}-day history on your plan).`
            : "Full signal history."
        }
      />
      <div className="mb-4">
        <Suspense>
          <SignalFilters
            sources={sources.map((s) => ({ value: s.id, label: s.name }))}
            signalTypes={signalTypes}
            advanced={can(viewer.access, "filters.advanced")}
            search={can(viewer.access, "search.history")}
          />
        </Suspense>
      </div>
      <div className="mb-2 text-xs text-muted-foreground">
        {result.total} signal{result.total === 1 ? "" : "s"}
      </div>
      <SignalList items={result.items} />
      {pages > 1 && (
        <div className="mt-4 flex items-center justify-end gap-2 text-sm">
          <Link href={pageHref(page - 1)} aria-disabled={page <= 1} className={cn(buttonVariants({ variant: "outline", size: "sm" }), page <= 1 && "pointer-events-none opacity-50")}>
            <ChevronLeft /> Prev
          </Link>
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          <Link href={pageHref(page + 1)} aria-disabled={page >= pages} className={cn(buttonVariants({ variant: "outline", size: "sm" }), page >= pages && "pointer-events-none opacity-50")}>
            Next <ChevronRight />
          </Link>
        </div>
      )}
    </>
  );
}
