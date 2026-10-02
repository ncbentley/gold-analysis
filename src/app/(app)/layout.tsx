import { and, eq, sql } from "drizzle-orm";
import { Check, Crown, LogOut, MailWarning } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { logoutAction, resendVerificationAction } from "@/app/actions/auth";
import { Sidebar, TopBar } from "@/components/app-nav";
import { ViewAsForm } from "@/components/view-as-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
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

const PROMO_POINTS = ["Live gold signals", "Source track records", "Replayed results", "AI setup analysis"];

function Promo({ showUpgrade }: { showUpgrade: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-xl p-4 shadow-[0_0_24px_-8px_rgb(245_197_66/0.6)] ring-1 ring-primary/50">
      <Image src="/brand/promo-bar.jpg" alt="" fill loading="eager" sizes="240px" className="object-cover object-bottom opacity-80" />
      <div className="absolute inset-0 bg-gradient-to-b from-[#050c1c] via-[#050c1c]/80 to-transparent" />
      <div className="relative">
        <p className="gold-text font-heading text-xl font-extrabold leading-[1.05]">
          Trade. Learn.
          <br />
          Grow together.
        </p>
        <ul className="mt-3 space-y-1 text-xs text-foreground/85">
          {PROMO_POINTS.map((p) => (
            <li key={p} className="flex items-center gap-1.5">
              <Check className="size-3.5 text-primary" />
              {p}
            </li>
          ))}
        </ul>
        {showUpgrade ? (
          <Link href="/billing#plans" className={cn(buttonVariants({ size: "sm" }), "mt-10 w-full")}>
            Upgrade today
          </Link>
        ) : (
          <div className="h-8" />
        )}
      </div>
    </div>
  );
}

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const viewer = await getViewer();
  const isAdmin = user.role === "admin";
  const count = isAdmin ? await reviewCount() : 0;
  const previewLabel = viewer.viewAs === "none" ? "No plan" : viewer.viewAs ? TIER_LABEL[viewer.viewAs] : null;
  const plan = isAdmin ? (previewLabel ? `Viewing as ${previewLabel}` : "Admin · full access") : viewer.subscription ? TIER_LABEL[viewer.subscription.tier] : "No plan";

  const footer = <Promo showUpgrade={!isAdmin && !viewer.subscription} />;

  const account = (
    <div className="flex items-center gap-2 rounded-xl border border-primary/35 bg-[#0a1428]/80 py-1 pl-1 pr-1.5 shadow-[0_0_16px_-6px_rgb(245_197_66/0.5)]">
      <Link href="/account" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg pr-1 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="gold-fill flex size-9 shrink-0 items-center justify-center rounded-full font-heading text-sm font-extrabold">{initials(user.email)}</span>
        <span className="hidden min-w-0 sm:block">
          <span className="block max-w-44 truncate text-[13px] font-semibold">{user.email}</span>
          <span className="mt-0.5 inline-flex items-center gap-1 rounded-full border border-primary/45 bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
            <Crown className="size-3" />
            {plan}
          </span>
        </span>
      </Link>
      <form action={logoutAction}>
        <Button variant="ghost" size="icon-sm" aria-label="Sign out" type="submit">
          <LogOut />
        </Button>
      </form>
    </div>
  );

  return (
    <div className="flex min-h-svh">
      <a href="#main" className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:left-3 focus:top-3">
        Skip to content
      </a>
      <Sidebar isAdmin={isAdmin} reviewCount={count} footer={footer} account={account} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar isAdmin={isAdmin} reviewCount={count} footer={footer} account={account} />
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
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-primary/15 bg-primary/[0.04] px-4 py-2 text-sm lg:px-8">
            <span className="text-foreground/85">{previewLabel ? `Member pages are showing the ${previewLabel} experience. Admin tools stay on your real account.` : "Member pages are showing the full admin experience."}</span>
            <Suspense>
              <ViewAsForm current={viewer.viewAs ?? "admin"} />
            </Suspense>
          </div>
        )}
        {!isAdmin && !viewer.subscription && user.emailVerifiedAt && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-primary/15 bg-primary/[0.04] px-4 py-2 text-sm lg:px-8">
            <span>Your feed is open for the last 7 days. Silver adds 180 days of history and the consolidated feed.</span>
            <Link href="/billing#plans" className="font-medium text-primary underline-offset-2 hover:underline">
              Compare packages
            </Link>
          </div>
        )}
        <main id="main" className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-5 lg:px-6 lg:py-6">
          {children}
        </main>
      </div>
    </div>
  );
}
