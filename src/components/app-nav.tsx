"use client";

import {
  Activity,
  ClipboardCheck,
  CreditCard,
  FileClock,
  Gauge,
  Inbox,
  LayoutDashboard,
  Link2,
  ListChecks,
  Menu,
  Radio,
  Send,
  Settings,
  ShieldCheck,
  UserRound,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Brand, BrandLockup } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> };

const MEMBER: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/signals", label: "Live signals", icon: Activity },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/account", label: "My profile", icon: UserRound },
];

const ADMIN: NavItem[] = [
  { href: "/admin", label: "Command center", icon: Gauge },
  { href: "/admin/telegram", label: "Telegram", icon: Send },
  { href: "/admin/review", label: "Review queue", icon: ClipboardCheck },
  { href: "/admin/events", label: "Raw events", icon: Inbox },
  { href: "/admin/signals", label: "Signals", icon: ListChecks },
  { href: "/admin/sources", label: "Sources", icon: Radio },
  { href: "/admin/jobs", label: "Jobs", icon: Workflow },
  { href: "/admin/entitlements", label: "Entitlements", icon: ShieldCheck },
  { href: "/admin/affiliates", label: "Broker links", icon: Link2 },
  { href: "/admin/audit", label: "Audit log", icon: FileClock },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

function useActive() {
  const pathname = usePathname();
  return (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`));
}

function NavLinks({ isAdmin, onNavigate, reviewCount }: { isAdmin: boolean; onNavigate?: () => void; reviewCount?: number }) {
  const active = useActive();
  const item = (l: NavItem, badge?: number) => {
    const on = active(l.href);
    return (
      <Link
        key={l.href}
        href={l.href}
        onClick={onNavigate}
        aria-current={on ? "page" : undefined}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground/80 transition-all duration-200 hover:bg-white/[0.04] hover:text-sidebar-foreground",
          on && "gold-fill font-semibold text-primary-foreground shadow-[0_0_20px_-4px_rgb(245_197_66/0.7)] hover:bg-transparent hover:text-primary-foreground",
        )}
      >
        <l.icon className={cn("size-[18px]", on ? "text-primary-foreground" : "text-sidebar-foreground/70")} />
        <span className="flex-1">{l.label}</span>
        {badge ? (
          <span className={cn("min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold", on ? "bg-primary-foreground/15" : "bg-loss text-white")}>{badge}</span>
        ) : null}
      </Link>
    );
  };
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">{MEMBER.map((l) => item(l))}</div>
      {isAdmin && (
        <div className="flex flex-col gap-1">
          <div className="px-3 pb-1 text-xs font-medium text-primary/70">Admin</div>
          {ADMIN.map((l) => item(l, l.href === "/admin/review" ? reviewCount : undefined))}
        </div>
      )}
    </nav>
  );
}

export function Sidebar({ isAdmin, reviewCount, footer, account }: { isAdmin: boolean; reviewCount?: number; footer: React.ReactNode; account: React.ReactNode }) {
  return (
    <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar/95 lg:flex">
      <div className="border-b border-sidebar-border px-4 pb-4 pt-5">
        <BrandLockup href="/dashboard" />
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-4">
        <NavLinks isAdmin={isAdmin} reviewCount={reviewCount} />
      </div>
      <div className="space-y-3 p-3">
        {footer}
        {account}
      </div>
    </aside>
  );
}

/** Mobile-only top bar; on desktop the sidebar carries navigation and the account chip. */
export function TopBar({ isAdmin, reviewCount, footer, account }: { isAdmin: boolean; reviewCount?: number; footer: React.ReactNode; account: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-sidebar-border bg-background/80 px-4 backdrop-blur-md lg:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Open navigation" />}>
          <Menu />
        </SheetTrigger>
        <SheetContent side="left" className="w-72 gap-0 overflow-y-auto bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="border-b border-sidebar-border px-4 pb-4 pt-5">
            <BrandLockup href="/dashboard" />
          </div>
          <div className="px-3 py-4">
            <NavLinks isAdmin={isAdmin} reviewCount={reviewCount} onNavigate={() => setOpen(false)} />
          </div>
          <div className="p-3">{footer}</div>
        </SheetContent>
      </Sheet>
      <Brand href="/dashboard" />
      <div className="ml-auto">{account}</div>
    </header>
  );
}
