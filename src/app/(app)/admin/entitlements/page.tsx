import { saveEntitlementsAction } from "@/app/actions/admin";
import { Field, Notice } from "@/components/admin-bits";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdmin } from "@/server/auth/guards";
import { ALL_FEATURES, FEATURE_CATALOG, TIER_LABEL, TIER_ORDER } from "@/server/entitlements/config";
import { getTierConfig } from "@/server/entitlements/service";

export const metadata = { title: "Entitlements" };

export default async function EntitlementsPage({ searchParams }: PageProps<"/admin/entitlements">) {
  await requireAdmin();
  const sp = await searchParams;
  const config = await getTierConfig();

  return (
    <>
      <PageHeader
        title="Entitlements"
        description="Which features each tier includes and how much history it can see. Enforced on the server for pages and the API; changes apply on the next request."
      />
      <Notice searchParams={sp} />
      <form action={saveEntitlementsAction}>
        <div className="overflow-hidden rounded-lg border bg-card/40">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Feature</TableHead>
                {TIER_ORDER.map((t) => (
                  <TableHead key={t} className="w-28 text-center">
                    {TIER_LABEL[t]}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow>
                <TableCell>
                  <div className="font-medium">History window (days)</div>
                  <div className="text-xs text-muted-foreground">Leave empty for unlimited</div>
                </TableCell>
                {TIER_ORDER.map((t) => (
                  <TableCell key={t} className="text-center">
                    <Input name={`${t}:historyDays`} inputMode="numeric" defaultValue={config[t].historyDays ?? ""} aria-label={`${TIER_LABEL[t]} history days`} className="mx-auto w-20 text-center" />
                  </TableCell>
                ))}
              </TableRow>
              {ALL_FEATURES.map((f) => (
                <TableRow key={f}>
                  <TableCell>
                    <div className="text-sm">{FEATURE_CATALOG[f]}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{f}</div>
                  </TableCell>
                  {TIER_ORDER.map((t) => (
                    <TableCell key={t} className="text-center">
                      <input
                        type="checkbox"
                        name={`${t}:features`}
                        value={f}
                        defaultChecked={config[t].features.includes(f)}
                        aria-label={`${TIER_LABEL[t]}: ${f}`}
                        className="size-4 accent-primary"
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Reason for change (required)" htmlFor="ent-reason" className="flex-1">
            <Input id="ent-reason" name="reason" required minLength={3} placeholder="e.g. Move MFE/MAE summary to Silver for launch promotion" />
          </Field>
          <Button type="submit">Save entitlements</Button>
        </div>
      </form>
    </>
  );
}
