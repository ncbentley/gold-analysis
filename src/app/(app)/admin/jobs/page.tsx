import { enqueueJobAction, retryJobAction, runJobsAction } from "@/app/actions/admin";
import { FilterLinks, NativeSelect, Notice, StateBadge } from "@/components/admin-bits";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/format";
import { listJobs } from "@/server/admin";
import { requireAdmin } from "@/server/auth/guards";
import { JOB_TYPES } from "@/server/jobs/queue";

export const metadata = { title: "Jobs" };

export default async function JobsPage({ searchParams }: PageProps<"/admin/jobs">) {
  await requireAdmin();
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : undefined;
  const { rows, counts } = await listJobs({ status });

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Durable background work: market data sync, outcome replay, statistics, AI analysis, source polling and billing reconciliation. Failed jobs retry with backoff."
        actions={
          <>
            <form action={enqueueJobAction} className="flex gap-2">
              <NativeSelect name="type" aria-label="Job to queue" className="w-52" defaultValue="MARKET_DATA_SYNC">
                {JOB_TYPES.filter((t) => !["RECALC_OUTCOME", "AI_ANALYZE_SIGNAL", "AI_ANALYZE_SOURCE", "REFRESH_SOURCE_STATS"].includes(t)).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
                <option value="recurring:telegram">Sync all Telegram channels</option>
              </NativeSelect>
              <Button type="submit" size="sm" variant="outline">
                Queue and run
              </Button>
            </form>
            <form action={runJobsAction}>
              <Button type="submit" size="sm">
                Run queued now
              </Button>
            </form>
          </>
        }
      />
      <Notice searchParams={sp} />
      <div className="mb-4">
        <FilterLinks
          base="/admin/jobs"
          param="status"
          current={status}
          options={[
            { value: "", label: "All" },
            ...["queued", "running", "succeeded", "failed"].map((s) => ({ value: s, label: s, count: counts[s] ?? 0 })),
          ]}
        />
      </div>
      <div className="overflow-hidden rounded-lg border bg-card/40">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Attempts</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Run after</TableHead>
              <TableHead>Result / error</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  No jobs{status ? ` with status ${status}` : ""}.
                </TableCell>
              </TableRow>
            )}
            {rows.map((j) => (
              <TableRow key={j.id}>
                <TableCell className="font-mono text-xs">{j.type}</TableCell>
                <TableCell>
                  <StateBadge state={j.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {j.attempts}/{j.maxAttempts}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{fmtDateTime(j.createdAt)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{fmtDateTime(j.runAfter)}</TableCell>
                <TableCell className="max-w-80 truncate font-mono text-[11px]">
                  {j.lastError ? (
                    <span className="text-loss" title={j.lastError}>
                      {j.lastError.split("\n")[0]}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{JSON.stringify(j.payloadJson)}</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {j.status === "failed" && (
                    <form action={retryJobAction}>
                      <input type="hidden" name="id" value={j.id} />
                      <Button type="submit" size="xs" variant="outline">
                        Retry
                      </Button>
                    </form>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
