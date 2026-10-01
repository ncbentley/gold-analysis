import { FileClock } from "lucide-react";
import Link from "next/link";
import { EmptyState, FilterLinks, JsonBlock } from "@/components/admin-bits";
import { PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { fmtDateTime } from "@/lib/format";
import { listAudit } from "@/server/audit";
import { requireAdmin } from "@/server/auth/guards";

export const metadata = { title: "Audit log" };

const ENTITY_LINK: Record<string, (id: string) => string> = {
  signal: (id) => `/admin/signals/${id}`,
  signal_outcome: (id) => `/admin/signals/${id}`,
  raw_event: (id) => `/admin/events/${id}`,
  source: () => `/admin/telegram`,
};

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireAdmin();
  const sp = await searchParams;
  const entityType = typeof sp.entity === "string" ? sp.entity : undefined;
  const rows = await listAudit({ entityType, limit: 200 });

  return (
    <>
      <PageHeader
        icon={FileClock}
        size="sm"
        title="Audit log"
        description="Every manual change and automated state transition, with the actor, the before and after values and the reason."
      />
      <div className="mb-4">
        <FilterLinks
          base="/admin/audit"
          param="entity"
          current={entityType}
          options={[
            { value: "", label: "All" },
            ...["signal", "signal_outcome", "raw_event", "source", "subscription", "entitlements", "affiliate_link", "user", "job"].map((e) => ({ value: e, label: e.replace("_", " ") })),
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={FileClock}>No audit entries for this filter.</EmptyState>
      ) : (
        <Card className="gap-0 py-0">
          <ul className="divide-y divide-border">
            {rows.map((a) => {
              const link = ENTITY_LINK[a.entityType]?.(a.entityId);
              return (
                <li key={a.id} className="px-4 py-3 text-sm transition-colors hover:bg-glow/[0.05]">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary ring-1 ring-primary/30">{a.action}</span>
                    <span className="text-xs text-muted-foreground">
                      {a.entityType}{" "}
                      {link ? (
                        <Link href={link} className="font-mono text-[#8db6ff] hover:text-primary hover:underline">
                          {a.entityId.slice(0, 8)}
                        </Link>
                      ) : (
                        <span className="font-mono">{a.entityId.slice(0, 16)}</span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      by <span className="font-medium text-foreground/85">{a.actorLabel}</span>
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground tabular-nums">{fmtDateTime(a.createdAt)}</span>
                  </div>
                  {a.reason && <div className="mt-1.5 text-xs text-amber-200/85">Reason: {a.reason}</div>}
                  {(a.beforeJson != null || a.afterJson != null) && (
                    <details className="mt-1.5">
                      <summary className="cursor-pointer text-xs font-medium text-[#8db6ff] hover:text-primary">Before / after</summary>
                      <div className="mt-2 grid gap-2 md:grid-cols-2">
                        <JsonBlock value={a.beforeJson} />
                        <JsonBlock value={a.afterJson} />
                      </div>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
