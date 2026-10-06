import { CalendarClock, CheckCircle2, CreditCard, Crown, Package, Receipt, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { billingPortalAction, cancelSubscriptionAction, resumeSubscriptionAction } from "@/app/actions/billing";
import { PageHeader, SectionTitle } from "@/components/page-header";
import { parsePlanParams, PlanPicker } from "@/components/plan-picker";
import { TIER_ICON } from "@/components/signal-bits";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/guards";
import { billingMode, PERIOD_LABEL } from "@/server/billing/config";
import { getPlan, listUserSubscriptions } from "@/server/billing/service";
import { appliedComplimentary } from "@/server/entitlements/complimentary";
import { TIER_LABEL } from "@/server/entitlements/config";
import { getViewer } from "@/server/entitlements/service";

export const metadata: Metadata = { title: "Billing" };


const PILL = "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold";

function InfoTile({ icon: IconCmp, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-black/30 px-4 py-3 ring-1 ring-glow/30">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-glow/10 text-[#8db6ff] ring-1 ring-glow/50">
        <IconCmp className="size-5" />
      </span>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="font-heading text-base font-bold tabular-nums tracking-tight">{children}</div>
      </div>
    </div>
  );
}

export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  const user = await requireUser("/billing");
  const sp = await searchParams;
  const viewer = await getViewer();
  const sub = viewer.subscription;
  const applied = user.role === "admin" ? null : appliedComplimentary(sub?.tier ?? null, viewer.complimentary);
  const [plan, history] = await Promise.all([sub ? getPlan(sub.tier, sub.period) : null, listUserSubscriptions(user.id)]);
  const mode = billingMode();
  const TierIcon = sub ? TIER_ICON[sub.tier] : applied ? TIER_ICON[applied] : Crown;
  const { period, highlight } = parsePlanParams(sp, sub ? { tier: sub.tier, period: sub.period } : undefined);

  return (
    <>
      <PageHeader icon={CreditCard} size="sm" title="Billing" description="Manage your membership. Prices and access are the same for every member of a tier." />
      {sp.checkout === "success" && (
        <Alert className="mb-4 border-win/30 bg-win/5">
          <CheckCircle2 className="text-win" />
          <AlertTitle>Membership active</AlertTitle>
          <AlertDescription>Your new plan is live. Locked sections are now available according to your tier.</AlertDescription>
        </Alert>
      )}
      {sp.checkout === "cancelled" && (
        <Alert className="mb-4">
          <CreditCard />
          <AlertTitle>Checkout cancelled</AlertTitle>
          <AlertDescription>No payment was taken. Pick a plan below whenever you’re ready.</AlertDescription>
        </Alert>
      )}
      {mode === "mock" && (
        <Alert className="mb-4 border-amber-400/30 bg-amber-400/5">
          <CreditCard className="text-amber-300" />
          <AlertTitle>Test-mode billing</AlertTitle>
          <AlertDescription>Stripe is not configured, so checkout is simulated locally. No payment details are collected.</AlertDescription>
        </Alert>
      )}
      <Card className={cn("rounded-2xl [--card-spacing:--spacing(5)]", (sub || applied) && "panel-gold shadow-[0_0_28px_-8px_rgb(245_197_66/0.55)] ring-primary/55")}>
        <CardHeader>
          <div className="flex items-center gap-3.5">
            <span
              className={cn(
                "flex size-12 shrink-0 items-center justify-center rounded-full ring-2",
                sub || applied ? "bg-black/40 text-primary shadow-[0_0_18px_-2px_rgb(245_197_66/0.6)] ring-primary/70" : "bg-glow/10 text-[#8db6ff] ring-glow/55",
              )}
            >
              <TierIcon className="size-6" />
            </span>
            <div className="min-w-0">
              <CardTitle className="text-sm font-semibold text-muted-foreground">Current plan</CardTitle>
              {sub ? (
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <span className="gold-text font-heading text-2xl font-extrabold tracking-tight">{TIER_LABEL[sub.tier]}</span>
                  <span className={cn(PILL, "border-primary/45 bg-primary/10 capitalize text-primary")}>{sub.period}</span>
                  {sub.cancelAtPeriodEnd ? (
                    <span className={cn(PILL, "border-amber-400/40 bg-amber-400/10 text-amber-300")}>Cancels {fmtDate(sub.currentPeriodEnd)}</span>
                  ) : (
                    <span className={cn(PILL, "border-win/45 bg-win/10 capitalize text-win shadow-[0_0_10px_-3px_var(--win)]")}>{sub.status}</span>
                  )}
                </div>
              ) : applied ? (
                <div className="mt-0.5 flex flex-wrap items-center gap-2">
                  <span className="gold-text font-heading text-2xl font-extrabold tracking-tight">{TIER_LABEL[applied]}</span>
                  <span className={cn(PILL, "border-primary/45 bg-primary/10 text-primary")}>Complimentary</span>
                </div>
              ) : (
                <div className="mt-0.5 font-heading text-xl font-bold tracking-tight">No membership</div>
              )}
            </div>
          </div>
          <CardDescription className="mt-2">
            {applied
              ? `Complimentary ${TIER_LABEL[applied]} access is on this account until an admin removes it. It does not change what you pay.`
              : sub
                ? "Access follows your subscription status and paid period."
                : "You do not have an active membership."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sub ? (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
                {plan && (
                  <InfoTile icon={Wallet} label="Price">
                    {fmtMoney(plan.amountCents, plan.currency)} / {PERIOD_LABEL[sub.period]}
                  </InfoTile>
                )}
                <InfoTile icon={CalendarClock} label={sub.cancelAtPeriodEnd ? "Access continues until" : "Renews on"}>
                  {fmtDate(sub.currentPeriodEnd)}
                </InfoTile>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href="#plans" className={buttonVariants({ variant: "outline" })}>Change plan</a>
                {sub.cancelAtPeriodEnd ? (
                  <form action={resumeSubscriptionAction}><Button type="submit">Resume</Button></form>
                ) : (
                  <form action={cancelSubscriptionAction}><Button type="submit" variant="destructive">Cancel at period end</Button></form>
                )}
                {sub.provider === "stripe" && (
                  <form action={billingPortalAction}><Button type="submit" variant="secondary">Billing portal</Button></form>
                )}
              </div>
            </div>
          ) : (
            <a href="#plans" className={buttonVariants()}>View plans</a>
          )}
        </CardContent>
        {sub?.cancelAtPeriodEnd && (
          <CardFooter className="text-xs text-muted-foreground">Cancelled memberships keep access until the end of the period already paid for.</CardFooter>
        )}
      </Card>

      <section id="plans" className="mt-8 scroll-mt-6">
        <SectionTitle icon={Package} title={sub ? "Change plan" : "Choose your package"} />
        <PlanPicker period={period} highlight={highlight} basePath="/billing" anchor="plans" />
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Prices in USD. Subscriptions renew automatically until cancelled; cancelling keeps access until the end of the paid period.
        </p>
      </section>

      <SectionTitle icon={Receipt} title="History" className="mt-8" />
      {history.length === 0 ? (
        <div className="rounded-xl border border-dashed border-glow/30 p-8 text-center text-sm text-muted-foreground">No subscriptions yet.</div>
      ) : (
        <div className="panel overflow-hidden rounded-xl shadow-[0_0_24px_-12px_rgb(47_123_255/0.6)] ring-1 ring-glow/30">
          <Table>
            <TableHeader>
              <TableRow className="bg-black/20 hover:bg-black/20">
                <TableHead>Started</TableHead>
                <TableHead>Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Period end</TableHead>
                <TableHead>Provider</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((h) => (
                <TableRow key={h.id}>
                  <TableCell className="tabular-nums">{fmtDate(h.createdAt)}</TableCell>
                  <TableCell className="font-medium">{TIER_LABEL[h.tier]} · {h.period}</TableCell>
                  <TableCell className={cn("capitalize", h.status === "active" && "text-win")}>{h.status}{h.cancelAtPeriodEnd && h.status === "active" ? " (cancelling)" : ""}</TableCell>
                  <TableCell className="tabular-nums">{fmtDate(h.currentPeriodEnd)}</TableCell>
                  <TableCell className="text-muted-foreground">{h.provider}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
