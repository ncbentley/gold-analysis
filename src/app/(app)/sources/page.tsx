import { ArrowRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { RValue } from "@/components/signal-bits";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtPct } from "@/lib/format";
import { getViewer } from "@/server/entitlements/service";
import { presentSourceSummary } from "@/server/presenters";
import { listSources } from "@/server/signals/queries";
import { getSourceStats } from "@/server/statistics/service";

export const metadata: Metadata = { title: "Sources" };

export default async function SourcesPage() {
  const viewer = await getViewer();
  const sources = await listSources({ includeQa: viewer.access.isAdmin });
  const rows = await Promise.all(sources.map(async (s) => presentSourceSummary(s, await getSourceStats(s.id), viewer.access, viewer.config)));
  return (
    <>
      <PageHeader title="Sources" description="Every tracked Telegram channel, measured against market data with the same deterministic rules." />
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">No channels are being tracked yet. Signal channels appear here as soon as they are connected.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((s) => (
            <Link key={s.id} href={`/sources/${s.slug}`} className="group">
              <Card className="h-full bg-card/60 transition-colors group-hover:border-primary/30">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    {s.name}
                    <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </CardTitle>
                  <CardDescription>{s.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{s.sourceType === "telegram" ? "Telegram" : s.sourceType}</Badge>
                    {s.isQa && <Badge variant="secondary">QA</Badge>}
                    {s.stats?.totalSignals ?? 0} signals · {s.stats?.closedTrades ?? 0} closed
                  </div>
                  {s.stats && !s.stats.summary.locked ? (
                    <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <div className="text-[11px] text-muted-foreground">Win rate</div>
                        <div className="font-semibold">{fmtPct(s.stats.summary.data.winRate)}</div>
                      </div>
                      <div>
                        <div className="text-[11px] text-muted-foreground">Avg R</div>
                        <RValue value={s.stats.summary.data.avgR} className="font-semibold" />
                      </div>
                      <div>
                        <div className="text-[11px] text-muted-foreground">Expectancy</div>
                        <RValue value={s.stats.summary.data.expectancy} className="font-semibold" />
                      </div>
                    </div>
                  ) : (
                    <p className="mt-4 text-xs text-muted-foreground">Performance statistics are included with Gold and Platinum.</p>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
