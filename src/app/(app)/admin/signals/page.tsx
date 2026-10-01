import { ChevronLeft, ChevronRight, ListChecks } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { LiveRefresh } from "@/components/live-refresh";
import { PageHeader } from "@/components/page-header";
import { SignalFilters } from "@/components/signal-filters";
import { SignalList } from "@/components/signal-list";
import { buttonVariants } from "@/components/ui/button";
import { requireAdmin } from "@/server/auth/guards";
import { getViewer } from "@/server/entitlements/service";
import { listSignalsForViewer, listSignalTypes, listSources, parseSignalFilters } from "@/server/signals/queries";

export const metadata = { title: "Signals" };
const PAGE = 50;

export default async function AdminSignalsPage({ searchParams }: PageProps<"/admin/signals">) {
  await requireAdmin();
  const sp = await searchParams;
  const viewer = await getViewer("admin");
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const filters = parseSignalFilters(sp);
  const [result, sources, signalTypes] = await Promise.all([
    listSignalsForViewer(viewer, filters, { limit: PAGE, offset: (page - 1) * PAGE }),
    listSources({ includeInactive: true, includeQa: true }),
    listSignalTypes(),
  ]);
  const pageHref = (p: number) => {
    const q = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
    q.set("page", String(p));
    return `/admin/signals?${q}`;
  };

  return (
    <>
      <LiveRefresh />
      <PageHeader icon={ListChecks} size="sm" title="Signals" description="Open a signal to correct fields, recalculate or override its outcome, and regenerate AI analysis." />
      <div className="mb-4">
        <Suspense>
          <SignalFilters sources={sources.map((s) => ({ value: s.id, label: s.name }))} signalTypes={signalTypes} advanced search />
        </Suspense>
      </div>
      <div className="mb-2 text-xs font-medium text-muted-foreground">
        <span className="font-mono text-foreground tabular-nums">{result.total.toLocaleString()}</span> signals
      </div>
      <SignalList items={result.items} hrefBase="/admin/signals" showSource />
      <div className="mt-4 flex justify-between">
        {page > 1 ? (
          <Link href={pageHref(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
            <ChevronLeft data-icon="inline-start" />
            Previous
          </Link>
        ) : (
          <span />
        )}
        {page * PAGE < result.total && (
          <Link href={pageHref(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Next
            <ChevronRight data-icon="inline-end" />
          </Link>
        )}
      </div>
    </>
  );
}
