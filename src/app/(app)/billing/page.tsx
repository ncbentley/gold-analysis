import { CheckCircle2, CreditCard } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { billingPortalAction, cancelSubscriptionAction, resumeSubscriptionAction } from "@/app/actions/billing";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtMoney } from "@/lib/format";
import { requireUser } from "@/server/auth/guards";
import { billingMode, PERIOD_LABEL } from "@/server/billing/config";
import { getEntitledSubscription, getPlan, listUserSubscriptions } from "@/server/billing/service";
import { TIER_LABEL } from "@/server/entitlements/config";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage({ searchParams }: PageProps<"/billing">) {
  const user = await requireUser("/billing");
  const sp = await searchParams;
  const [sub, history] = await Promise.all([getEntitledSubscription(user.id), listUserSubscriptions(user.id)]);
  const plan = sub ? await getPlan(sub.tier, sub.period) : null;
  const mode = billingMode();

  return (
    <>
      <PageHeader title="Billing" description="Manage your membership. Prices and access are the same for every member of a tier." />
      {sp.checkout === "success" && (
        <Alert className="mb-4 border-win/30 bg-win/5">
          <CheckCircle2 className="text-win" />
          <AlertTitle>Membership active</AlertTitle>
          <AlertDescription>Your new plan is live. Locked sections are now available according to your tier.</AlertDescription>
        </Alert>
      )}
      {mode === "mock" && (
        <Alert className="mb-4">
          <CreditCard />
          <AlertTitle>Test-mode billing</AlertTitle>
          <AlertDescription>Stripe is not configured, so checkout is simulated locally. No payment details are collected.</AlertDescription>
        </Alert>
      )}
      <Card className="bg-card/60">
        <CardHeader>
          <CardTitle>Current plan</CardTitle>
          <CardDescription>{sub ? "Access follows your subscription status and paid period." : "You do not have an active membership."}</CardDescription>
        </CardHeader>
        <CardContent>
          {sub ? (
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-2xl font-semibold">
                  {TIER_LABEL[sub.tier]}
                  <Badge variant="outline" className="capitalize">{sub.period}</Badge>
                  {sub.cancelAtPeriodEnd ? <Badge variant="outline" className="border-amber-400/40 text-amber-300">Cancels {fmtDate(sub.currentPeriodEnd)}</Badge> : <Badge variant="outline" className="border-win/30 text-win">{sub.status}</Badge>}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {plan ? `${fmtMoney(plan.amountCents, plan.currency)} / ${PERIOD_LABEL[sub.period]}` : null} ·{" "}
                  {sub.cancelAtPeriodEnd ? "Access continues until" : "Renews on"} {fmtDate(sub.currentPeriodEnd)}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link href="/pricing" className={buttonVariants({ variant: "outline" })}>Change plan</Link>
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
            <Link href="/pricing" className={buttonVariants()}>View plans</Link>
          )}
        </CardContent>
        {sub?.cancelAtPeriodEnd && (
          <CardFooter className="text-xs text-muted-foreground">Cancelled memberships keep access until the end of the period already paid for.</CardFooter>
        )}
      </Card>

      <h2 className="mb-3 mt-8 text-lg font-semibold">History</h2>
      {history.length === 0 ? (
        <p className="text-sm text-muted-foreground">No subscriptions yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
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
                  <TableCell>{fmtDate(h.createdAt)}</TableCell>
                  <TableCell>{TIER_LABEL[h.tier]} · {h.period}</TableCell>
                  <TableCell className="capitalize">{h.status}{h.cancelAtPeriodEnd && h.status === "active" ? " (cancelling)" : ""}</TableCell>
                  <TableCell>{fmtDate(h.currentPeriodEnd)}</TableCell>
                  <TableCell>{h.provider}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
