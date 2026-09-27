import Link from "next/link";
import { saveAffiliateAction } from "@/app/actions/admin";
import { Field, Notice } from "@/components/admin-bits";
import { PageHeader } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { listAffiliateLinks, PLACEMENTS } from "@/server/affiliates";
import { requireAdmin } from "@/server/auth/guards";
import type { AffiliateLink } from "@/server/db/schema";

export const metadata = { title: "Affiliates" };

const PLACEMENT_LABEL: Record<string, string> = { landing: "Landing page", pricing: "Pricing", dashboard: "Dashboard", signal_detail: "Signal detail" };

function AffiliateForm({ link }: { link?: AffiliateLink }) {
  const key = link?.id ?? "new";
  return (
    <form action={saveAffiliateAction} className="grid gap-3 md:grid-cols-3">
      {link && <input type="hidden" name="id" value={link.id} />}
      <Field label="Broker name" htmlFor={`${key}-name`}>
        <Input id={`${key}-name`} name="name" required defaultValue={link?.name} />
      </Field>
      <Field label="Slug" htmlFor={`${key}-slug`} hint="Tracked redirect at /go/slug">
        <Input id={`${key}-slug`} name="slug" required pattern="[a-z0-9-]+" defaultValue={link?.slug} />
      </Field>
      <Field label="Destination URL" htmlFor={`${key}-url`}>
        <Input id={`${key}-url`} name="destinationUrl" type="url" required defaultValue={link?.destinationUrl} />
      </Field>
      <Field label="Disclosure" htmlFor={`${key}-disc`} className="md:col-span-3">
        <Textarea id={`${key}-disc`} name="disclosure" rows={2} required defaultValue={link?.disclosure ?? "Affiliate link: we may be paid if you open an account. Membership access never depends on broker signup."} />
      </Field>
      <div className="flex flex-wrap items-center gap-4 text-sm md:col-span-3">
        {PLACEMENTS.map((p) => (
          <label key={p} className="flex items-center gap-1.5">
            <input type="checkbox" name="placements" value={p} defaultChecked={link?.placements.includes(p)} className="accent-primary" /> {PLACEMENT_LABEL[p]}
          </label>
        ))}
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="active" defaultChecked={link?.active ?? true} className="accent-primary" /> Active
        </label>
        <Button type="submit" size="sm" className="ml-auto">
          {link ? "Save" : "Add link"}
        </Button>
      </div>
    </form>
  );
}

export default async function AffiliatesPage({ searchParams }: PageProps<"/admin/affiliates">) {
  await requireAdmin();
  const sp = await searchParams;
  const links = await listAffiliateLinks();
  const adding = sp.new === "1";

  return (
    <>
      <PageHeader
        title="Affiliate links"
        description="Broker links shown in configured placements. Clicks are counted through a redirect. Membership access is never tied to broker signup."
        actions={
          !adding && (
            <Link href="/admin/affiliates?new=1" className={buttonVariants({ size: "sm" })}>
              Add link
            </Link>
          )
        }
      />
      <Notice searchParams={sp} />
      <div className="space-y-4">
        {adding && (
          <Card className="bg-card/60">
            <CardHeader>
              <CardTitle className="text-base">New affiliate link</CardTitle>
            </CardHeader>
            <CardContent>
              <AffiliateForm />
            </CardContent>
          </Card>
        )}
        {links.length === 0 && !adding && <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">No affiliate links yet.</div>}
        {links.map((l) => (
          <Card key={l.id} className="bg-card/60">
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                <span>
                  {l.name} {!l.active && <span className="text-xs font-normal text-muted-foreground">(inactive)</span>}
                </span>
                <span className="text-sm font-normal text-muted-foreground">{l.clickCount.toLocaleString()} clicks</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <AffiliateForm link={l} />
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  );
}
