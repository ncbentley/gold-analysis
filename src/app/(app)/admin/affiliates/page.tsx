import { Link2, MousePointerClick, Plus } from "lucide-react";
import Link from "next/link";
import { saveAffiliateAction } from "@/app/actions/admin";
import { EmptyState, Field, Notice } from "@/components/admin-bits";
import { PageHeader, SectionTitle } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { listAffiliateLinks, PLACEMENTS } from "@/server/affiliates";
import { requireAdmin } from "@/server/auth/guards";
import type { AffiliateLink } from "@/server/db/schema";

export const metadata = { title: "Affiliates" };

const PLACEMENT_LABEL: Record<string, string> = { landing: "Landing page", pricing: "Pricing", dashboard: "Dashboard", signal_detail: "Signal detail" };

const CHIP =
  "flex cursor-pointer items-center gap-2 rounded-lg border border-glow/30 bg-[#0a1630]/70 px-2.5 py-1.5 text-[13px] font-medium transition-colors hover:border-glow/60 has-[:checked]:border-primary/55 has-[:checked]:bg-primary/10 has-[:checked]:text-primary has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50";

function AffiliateForm({ link }: { link?: AffiliateLink }) {
  const key = link?.id ?? "new";
  return (
    <form action={saveAffiliateAction} className="grid gap-3 md:grid-cols-3">
      {link && <input type="hidden" name="id" value={link.id} />}
      <Field label="Broker name" htmlFor={`${key}-name`}>
        <Input id={`${key}-name`} name="name" required defaultValue={link?.name} />
      </Field>
      <Field label="Slug" htmlFor={`${key}-slug`} hint="Tracked redirect at /go/slug">
        <Input id={`${key}-slug`} name="slug" required pattern="[a-z0-9-]+" defaultValue={link?.slug} className="font-mono" />
      </Field>
      <Field label="Destination URL" htmlFor={`${key}-url`}>
        <Input id={`${key}-url`} name="destinationUrl" type="url" required defaultValue={link?.destinationUrl} />
      </Field>
      <Field label="Disclosure" htmlFor={`${key}-disc`} className="md:col-span-3">
        <Textarea id={`${key}-disc`} name="disclosure" rows={2} required defaultValue={link?.disclosure ?? "Affiliate link: we may be paid if you open an account. Membership access never depends on broker signup."} />
      </Field>
      <div className="flex flex-wrap items-center gap-2 md:col-span-3">
        {PLACEMENTS.map((p) => (
          <label key={p} className={CHIP}>
            <input type="checkbox" name="placements" value={p} defaultChecked={link?.placements.includes(p)} className="accent-primary" /> {PLACEMENT_LABEL[p]}
          </label>
        ))}
        <label className={CHIP}>
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
        icon={Link2}
        size="sm"
        title="Broker links"
        description="Broker links shown in configured placements. Clicks are counted through a redirect. Membership access is never tied to broker signup."
        actions={
          !adding && (
            <Link href="/admin/affiliates?new=1" className={buttonVariants({ size: "sm" })}>
              <Plus data-icon="inline-start" />
              Add link
            </Link>
          )
        }
      />
      <Notice searchParams={sp} />
      <div className="space-y-4">
        {adding && (
          <Card className="panel-gold ring-primary/55 shadow-[0_0_28px_-8px_rgb(245_197_66/0.55)]">
            <CardHeader>
              <SectionTitle icon={Plus} title="New affiliate link" className="mb-0" />
            </CardHeader>
            <CardContent>
              <AffiliateForm />
            </CardContent>
          </Card>
        )}
        {links.length === 0 && !adding && (
          <EmptyState
            icon={Link2}
            action={
              <Link href="/admin/affiliates?new=1" className={buttonVariants({ size: "sm" })}>
                <Plus data-icon="inline-start" />
                Add link
              </Link>
            }
          >
            No affiliate links yet.
          </EmptyState>
        )}
        {links.map((l) => (
          <Card key={l.id} className={l.active ? undefined : "opacity-75"}>
            <CardHeader>
              <SectionTitle
                icon={Link2}
                className="mb-0"
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {l.name}
                    {!l.active && <span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 font-sans text-[11px] font-semibold text-muted-foreground">inactive</span>}
                  </span>
                }
                action={
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-glow/10 px-2.5 py-1 text-xs font-medium text-[#8db6ff] ring-1 ring-glow/35">
                    <MousePointerClick className="size-3.5" />
                    <span className="font-mono tabular-nums">{l.clickCount.toLocaleString()}</span> clicks
                  </span>
                }
              />
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
