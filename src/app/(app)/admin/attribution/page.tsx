import { Megaphone } from "lucide-react";
import { EmptyState } from "@/components/admin-bits";
import { PageHeader, SectionTitle } from "@/components/page-header";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/format";
import { getAttributionReport, type AttributionBreakdown } from "@/server/analytics/report";
import { requireAdmin } from "@/server/auth/guards";

export const metadata = { title: "Attribution" };

export default async function AttributionPage() {
  await requireAdmin();
  const report = await getAttributionReport();
  const empty = report.visits.length === 0 && report.recent.length === 0;

  return (
    <>
      <PageHeader
        icon={Megaphone}
        size="sm"
        title="Attribution"
        description="First-party campaign data from the links people actually open. UTM tags, ad click ids and the referring site are stored on the visitor, copied onto the account at signup, and stamped on every product event."
      />
      {empty ? (
        <EmptyState icon={Megaphone}>
          No visits yet. Tag a link before you send it, for example{" "}
          <span className="font-mono text-foreground/80">/?utm_source=newsletter&amp;utm_medium=email&amp;utm_campaign=launch</span>. A visit with no tags is still
          recorded, using the referring site or “direct”.
        </EmptyState>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          <Breakdown title="Visits · 30 days" rows={report.visits} empty="No campaign or direct visits in the last 30 days." />
          <Breakdown title="Accounts by first touch" rows={report.firstTouchAccounts} empty="No accounts have been tied to a visit yet." />
          <Breakdown title="Accounts by last touch" rows={report.lastTouchAccounts} empty="No accounts have been tied to a visit yet." />
        </div>
      )}

      {report.recent.length > 0 && (
        <section className="mt-6">
          <SectionTitle icon={Megaphone} title="Recent arrivals" />
          <Card className="gap-0 py-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Landing</TableHead>
                  <TableHead>Referrer</TableHead>
                  <TableHead>Parameters</TableHead>
                  <TableHead>Account</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.recent.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs text-muted-foreground tabular-nums">{fmtDateTime(row.touchedAt)}</TableCell>
                    <TableCell className="font-mono text-xs">{row.landing}</TableCell>
                    <TableCell className="max-w-48 truncate font-mono text-xs text-muted-foreground">{row.referrer ?? "—"}</TableCell>
                    <TableCell className="max-w-md truncate font-mono text-xs">{paramSummary(row.params)}</TableCell>
                    <TableCell className="text-xs">{row.email ?? "Anonymous"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </section>
      )}
    </>
  );
}

function Breakdown({ title, rows, empty }: { title: string; rows: AttributionBreakdown[]; empty: string }) {
  return (
    <Card>
      <CardHeader>
        <SectionTitle title={title} className="mb-0" />
      </CardHeader>
      <CardContent className="text-sm">
        {rows.length === 0 ? (
          <p className="text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y divide-border/70">
            {rows.map((row) => (
              <li key={`${row.source}|${row.medium}|${row.campaign}`} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{row.source}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">
                    {row.medium}
                    {row.campaign ? ` · ${row.campaign}` : ""}
                  </span>
                </span>
                <span className="font-mono text-xs tabular-nums">{row.n}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function paramSummary(params: Record<string, string>) {
  const entries = Object.entries(params);
  if (!entries.length) return "—";
  return entries.map(([key, value]) => `${key}=${value.length > 28 ? `${value.slice(0, 28)}…` : value}`).join("  ");
}
