import Link from "next/link";
import { Brand } from "@/components/brand";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/server/auth";

export async function SiteHeader() {
  const user = await getCurrentUser();
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
        <Brand />
        <nav className="flex items-center gap-1 text-sm">
          <Link href="/#how-it-works" className="hidden rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground sm:block">How it works</Link>
          <Link href="/pricing" className="rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground">Pricing</Link>
          {user ? (
            <Link href="/dashboard" className={cn(buttonVariants({ size: "sm" }), "ml-2")}>Dashboard</Link>
          ) : (
            <>
              <Link href="/login" className="rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground">Sign in</Link>
              <Link href="/signup" className={cn(buttonVariants({ size: "sm" }), "ml-1")}>Create account</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border/60">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-xs text-muted-foreground md:flex-row md:items-start md:justify-between">
        <div className="max-w-xl space-y-2">
          <Brand className="text-sm text-foreground" />
          <p>
            Aurum Ledger records third-party gold trading signals and measures them against market data. It is general information for all members of a tier, not
            personal financial advice. Past performance does not guarantee future results. Trading leveraged products carries a high risk of loss.
          </p>
        </div>
        <div className="flex gap-4">
          <Link href="/pricing" className="hover:text-foreground">Pricing</Link>
          <Link href="/terms" className="hover:text-foreground">Terms</Link>
          <Link href="/privacy" className="hover:text-foreground">Privacy</Link>
        </div>
      </div>
    </footer>
  );
}
