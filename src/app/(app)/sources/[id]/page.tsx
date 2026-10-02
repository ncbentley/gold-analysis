import { ArrowLeft, History, Radio, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LockedPanel } from "@/components/locked";
import { PageHeader, SectionTitle } from "@/components/page-header";
import { SignalList } from "@/components/signal-list";
import { SourceHistory, SourceSummary } from "@/components/source-performance";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { can, lowestTierWith } from "@/server/entitlements/access";
import { getViewer } from "@/server/entitlements/service";
import { presentSourceStats, sourceDisplayName } from "@/server/presenters";
import { getSourceBySlugOrId, listSignalsForViewer } from "@/server/signals/queries";
import { getSourceStats } from "@/server/statistics/service";

export const metadata: Metadata = { title: "Source" };

export default async function SourcePage({ params }: PageProps<"/sources/[id]">) {
  const { id } = await params;
  const viewer = await getViewer();
  const { access, config } = viewer;
  const back = (
    <Link
      href="/sources"
      className="mb-3 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="size-4" /> Top sources
    </Link>
  );
  if (!can(access, "signals.core")) {
    return (
      <>
        {back}
        <LockedPanel feature="signals.core" requiredTier={lowestTierWith("signals.core", config)} title="Sources are available to members" userId={viewer.user?.id} />
      </>
    );
  }
  const source = await getSourceBySlugOrId(id, { includeQa: access.isAdmin, allowSlug: access.isAdmin });
  if (!source || (!source.active && !access.isAdmin)) notFound();

  const [stats, recent] = await Promise.all([
    getSourceStats(source.id),
    listSignalsForViewer(viewer, {}, { limit: 15, sourceScope: source.id }),
  ]);
  const presented = presentSourceStats(stats, access, config);
  const uid = viewer.user?.id;

  return (
    <>
      {back}
      <PageHeader
        size="sm"
        icon={Radio}
        title={sourceDisplayName(source, access)}
        description={access.isAdmin ? `Members see this source as “${source.nickname}”.` : "Results come only from replaying each signal against XAU/USD minute data."}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="panel-gold shadow-[0_0_28px_-8px_rgb(245_197_66/0.55)] ring-primary/55">
          <CardHeader className="border-b border-glow/15">
            <CardTitle className="flex items-center gap-2.5 text-base">
              <Trophy className="size-4 text-primary" /> Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SourceSummary stats={presented} userId={uid} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader className="border-b border-glow/15">
            <CardTitle className="flex items-center gap-2.5 text-base">
              <History className="size-4 text-primary" /> Historical context
            </CardTitle>
          </CardHeader>
          <CardContent>
            <SourceHistory stats={presented} userId={uid} />
          </CardContent>
        </Card>
      </div>
      <section className="mt-8">
        <SectionTitle icon={Radio} title="Recent signals" />
        <SignalList items={recent.items} empty="No signals from this source in your history window." />
      </section>
    </>
  );
}
