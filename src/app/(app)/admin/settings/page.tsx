import { saveMarketDataAction } from "@/app/actions/admin";
import { Field, NativeSelect, Notice } from "@/components/admin-bits";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fmtDateTime } from "@/lib/format";
import { requireAdmin } from "@/server/auth/guards";
import { getMarketDataConfig, getMarketDataSummary } from "@/server/market-data";
import { secretKeySource } from "@/server/settings";

export const metadata = { title: "Settings" };

const KEY_SOURCE_LABEL = {
  env: "APP_SECRET environment variable",
  "dev-file": "Development key in .data/app-secret (set APP_SECRET in production)",
  missing: "Missing. Set APP_SECRET before storing credentials.",
} as const;

export default async function AdminSettingsPage({ searchParams }: PageProps<"/admin/settings">) {
  await requireAdmin();
  const sp = await searchParams;
  const [cfg, bars] = await Promise.all([getMarketDataConfig(), getMarketDataSummary()]);
  const keySource = secretKeySource();

  return (
    <>
      <PageHeader title="Settings" description="Credentials entered here are encrypted at rest and never sent to the browser." />
      <Notice searchParams={sp} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-card/60">
          <CardHeader>
            <CardTitle className="text-base">Market data</CardTitle>
            <CardDescription>
              Outcomes are replayed against 1-minute XAU/USD bars. Synthetic prices are for development only; results computed against them are not
              real.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {cfg.provider === "mock" && (
              <p className="mb-4 rounded-md border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-sm text-amber-200/90">
                Synthetic prices are active. Connect Twelve Data (a free plan covers one instrument) before showing results to members.
              </p>
            )}
            <form action={saveMarketDataAction} className="space-y-3">
              <Field label="Provider" htmlFor="md-provider">
                <NativeSelect id="md-provider" name="provider" defaultValue={cfg.provider}>
                  <option value="twelvedata">Twelve Data (real XAU/USD)</option>
                  <option value="mock">Synthetic (development)</option>
                </NativeSelect>
              </Field>
              <Field
                label="Twelve Data API key"
                htmlFor="md-key"
                hint={
                  cfg.provider === "twelvedata" && cfg.twelvedataApiKey
                    ? `A key is stored (${cfg.configuredIn === "env" ? "from TWELVEDATA_API_KEY" : "saved here"}). Leave blank to keep it.`
                    : "From twelvedata.com, under API keys."
                }
              >
                <Input id="md-key" name="twelvedataApiKey" type="password" autoComplete="off" spellCheck={false} />
              </Field>
              <p className="text-xs text-muted-foreground">
                Switching provider clears stored bars, re-fetches history back to the oldest signal and recalculates every outcome.
              </p>
              <Button type="submit">Save market data</Button>
            </form>
          </CardContent>
        </Card>

        <Card className="bg-card/60">
          <CardHeader>
            <CardTitle className="text-base">Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <Row k="Active provider" v={cfg.provider === "mock" ? "Synthetic" : "Twelve Data"} />
            <Row k="Configured in" v={cfg.configuredIn === "admin" ? "Admin settings" : cfg.configuredIn === "env" ? "Environment" : "Default"} />
            <Row k="Bars stored" v={bars.count.toLocaleString()} />
            <Row k="Coverage" v={bars.first ? `${fmtDateTime(bars.first)} to ${fmtDateTime(bars.last)}` : "none"} />
            <Row k="Encryption key" v={<span className={keySource === "missing" ? "text-loss" : undefined}>{KEY_SOURCE_LABEL[keySource]}</span>} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{k}</span>
      <span className="text-right">{v}</span>
    </div>
  );
}
