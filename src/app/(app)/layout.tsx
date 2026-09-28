import { and, eq, sql } from "drizzle-orm";
import { LogOut, MailWarning } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { logoutAction, resendVerificationAction } from "@/app/actions/auth";
import { MobileNav, Sidebar } from "@/components/app-nav";
import { ViewAsForm } from "@/components/view-as-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/server/auth/guards";
import { getDb } from "@/server/db";
import { parseResults } from "@/server/db/schema";
import { TIER_LABEL } from "@/server/entitlements/config";
import { getViewer } from "@/server/entitlements/service";

async function reviewCount() {
  const db = await getDb();
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(parseResults)
    .where(and(eq(parseResults.isCurrent, true), eq(parseResults.status, "needs_review")));
  return row.n;
}

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const viewer = await getViewer();
  const isAdmin = user.role === "admin";
  const count = isAdmin ? await reviewCount() : 0;
  const previewLabel = viewer.viewAs === "none" ? "No plan" : viewer.viewAs ? TIER_LABEL[viewer.viewAs] : null;
  const plan = isAdmin ? (previewLabel ? `Viewing as ${previewLabel}` : "Admin") : viewer.subscription ? TIER_LABEL[viewer.subscription.tier] : "No plan";

  const footer = (
    <div className="mt-3 border-t pt-3">
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="min-w-0">
          <div className="truncate text-xs font-medium">{user.email}</div>
          <Badge variant="outline" className="mt-1 border-primary/30 text-[10px] text-primary">
            {plan}
          </Badge>
        </div>
        <form action={logoutAction}>
          <Button variant="ghost" size="icon-sm" aria-label="Sign out" type="submit">
            <LogOut />
          </Button>
        </form>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-svh">
      <Sidebar isAdmin={isAdmin} reviewCount={count} footer={footer} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav isAdmin={isAdmin} reviewCount={count} footer={footer} />
        {!user.emailVerifiedAt && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-400/20 bg-amber-400/5 px-4 py-2 text-sm text-amber-200 lg:px-8">
            <MailWarning className="size-4" />
            <span>Verify your email to start a membership.</span>
            <form action={async () => { "use server"; await resendVerificationAction(); }}>
              <button type="submit" className="underline underline-offset-2 hover:text-amber-100">
                Resend link
              </button>
            </form>
          </div>
        )}
        {isAdmin && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-primary/15 bg-primary/5 px-4 py-2 text-sm lg:px-8">
            <span>{previewLabel ? `Member pages are showing the ${previewLabel} experience. Admin tools stay on your real account.` : "Member pages are showing the full admin experience."}</span>
            <Suspense>
              <ViewAsForm current={viewer.viewAs ?? "admin"} />
            </Suspense>
          </div>
        )}
        {!isAdmin && !viewer.subscription && user.emailVerifiedAt && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-primary/15 bg-primary/5 px-4 py-2 text-sm lg:px-8">
            <span>You don’t have an active membership, so signal data is locked.</span>
            <Link href="/pricing" className="font-medium text-primary underline-offset-2 hover:underline">
              Compare plans
            </Link>
          </div>
        )}
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
