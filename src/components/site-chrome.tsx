import Link from "next/link";
import { Brand } from "@/components/brand";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/server/auth";

const NAV_LINK = "whitespace-nowrap rounded-lg px-2 py-1.5 font-medium sm:px-3 text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground";

export async function SiteHeader() {
  const user = await getCurrentUser();
  return (
    <header className="sticky top-0 z-40 border-b border-primary/15 bg-[#050c1c]/80 shadow-[0_8px_30px_-18px_rgb(47_123_255/0.6)] backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4">
        <Brand className="shrink-0 max-sm:[&>span]:hidden" />
        <nav aria-label="Main" className="flex items-center gap-1 text-sm">
          <Link href="/#ladder" className={cn(NAV_LINK, "hidden md:block")}>How it works</Link>
          <Link href="/pricing" className={NAV_LINK}>Pricing</Link>
          {user ? (
            <Link href="/dashboard" className={cn(buttonVariants({ size: "sm" }), "ml-2")}>Dashboard</Link>
          ) : (
            <>
              <Link href="/login" className={NAV_LINK}>Sign in</Link>
              <Link href="/signup" className={cn(buttonVariants({ size: "sm" }), "ml-1")}>Create account</Link>
            </>
          )}
        </nav>
      </div>
      <div className="h-px bg-gradient-to-r from-primary/0 via-primary/50 to-primary/0" />
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-primary/15 bg-[#050c1c]/70">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-xs text-muted-foreground md:flex-row md:items-start md:justify-between">
        <div className="max-w-xl space-y-3">
          <Brand />
          <p className="leading-relaxed">
            Gold Intelligence Gateway records third-party gold trading signals and measures them against market data. It is general information for all members of a
            tier, not personal financial advice. Past performance does not guarantee future results. Trading leveraged products carries a high risk of loss.
          </p>
        </div>
        <nav aria-label="Footer" className="flex gap-5 text-sm">
          <Link href="/pricing" className="hover:text-primary">Pricing</Link>
          <Link href="/terms" className="hover:text-primary">Terms</Link>
          <Link href="/privacy" className="hover:text-primary">Privacy</Link>
        </nav>
      </div>
    </footer>
  );
}
