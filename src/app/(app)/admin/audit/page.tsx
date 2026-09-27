import Link from "next/link";
import { FilterLinks, JsonBlock } from "@/components/admin-bits";
import { PageHeader } from "@/components/page-header";
import { fmtDateTime } from "@/lib/format";
import { listAudit } from "@/server/audit";
import { requireAdmin } from "@/server/auth/guards";

export const metadata = { title: "Audit log" };

const ENTITY_LINK: Record<string, (id: string) => string> = {
  signal: (id) => `/admin/signals/${id}`,
  signal_outcome: (id) => `/admin/signals/${id}`,
  raw_event: (id) => `/admin/events/${id}`,
  source: (id) => `/admin/sources?edit=${id}`,
};

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireAdmin();
  const sp = await searchParams;
  const entityType = typeof sp.entity === "string" ? sp.entity : undefined;
  const rows = await listAudit({ entityType, limit: 200 });

  return (
    <>
      <PageHeader title="Audit log" description="Every manual change and automated state transition, with the actor, the before and after values and the reason." />
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
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">No audit entries for this filter.</div>
      ) : (
        <ul className="divide-y rounded-lg border bg-card/40">
          {rows.map((a) => {
            const link = ENTITY_LINK[a.entityType]?.(a.entityId);
            return (
              <li key={a.id} className="p-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-xs font-medium">{a.action}</span>
                  <span className="text-xs text-muted-foreground">
                    {a.entityType}{" "}
                    {link ? (
                      <Link href={link} className="text-primary hover:underline">
                        {a.entityId.slice(0, 8)}
                      </Link>
                    ) : (
                      a.entityId.slice(0, 16)
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">by {a.actorLabel}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{fmtDateTime(a.createdAt)}</span>
                </div>
                {a.reason && <div className="mt-1 text-xs text-amber-200/80">Reason: {a.reason}</div>}
                {(a.beforeJson != null || a.afterJson != null) && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-muted-foreground">Before / after</summary>
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
      )}
    </>
  );
}
