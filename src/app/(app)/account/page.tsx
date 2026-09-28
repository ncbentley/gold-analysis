import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDate } from "@/lib/format";
import { requireUser } from "@/server/auth/guards";
import { FEATURE_CATALOG, TIER_LABEL } from "@/server/entitlements/config";
import { getViewer } from "@/server/entitlements/service";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const user = await requireUser("/account");
  const { access, subscription, viewAs } = await getViewer();
  return (
    <>
      <PageHeader title="Account" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="bg-card/60">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>We store only what is needed to run your membership.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span>{user.email}</span></div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Email status</span>
              {user.emailVerifiedAt ? <Badge variant="outline" className="border-win/30 text-win">Verified</Badge> : <Badge variant="outline" className="border-amber-400/40 text-amber-300">Unverified</Badge>}
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground">Role</span><span className="capitalize">{user.role}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Member since</span><span>{fmtDate(user.createdAt)}</span></div>
            <div className="flex flex-wrap gap-2 pt-2">
              <Link href="/forgot-password" className={buttonVariants({ variant: "outline", size: "sm" })}>Change password</Link>
              <form action={logoutAction}><Button type="submit" variant="ghost" size="sm">Sign out</Button></form>
            </div>
            <p className="pt-2 text-xs text-muted-foreground">
              We never ask for brokerage credentials, account balances or positions. The product does not personalise information to your finances.
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card/60">
          <CardHeader>
            <CardTitle>Your access</CardTitle>
            <CardDescription>
              {viewAs === "none"
                ? "Previewing a visitor with no plan."
                : viewAs
                  ? `Previewing the ${TIER_LABEL[viewAs]} membership.`
                  : user.role === "admin"
                    ? "Administrators can see everything."
                    : subscription
                      ? `${TIER_LABEL[subscription.tier]} membership`
                      : "No active membership"}
              {access.historyDays !== null && access.tier ? ` · ${access.historyDays}-day history` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {access.features.size ? (
              <ul className="space-y-1.5 text-sm">
                {[...access.features].map((f) => (
                  <li key={f} className="flex gap-2"><span className="text-primary">✓</span>{FEATURE_CATALOG[f]}</li>
                ))}
              </ul>
            ) : (
              <Link href="/pricing" className={buttonVariants()}>Choose a plan</Link>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
