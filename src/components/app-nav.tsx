"use client";

import {
  Activity,
  BarChart3,
  ClipboardCheck,
  Cog,
  CreditCard,
  FileClock,
  Gauge,
  Inbox,
  LayoutDashboard,
  Link2,
  ListChecks,
  Menu,
  Radio,
  ShieldCheck,
  User,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const MEMBER = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/signals", label: "Signals", icon: Activity },
  { href: "/sources", label: "Sources", icon: Radio },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/account", label: "Account", icon: User },
];

const ADMIN = [
  { href: "/admin", label: "Overview", icon: Gauge },
  { href: "/admin/review", label: "Review queue", icon: ClipboardCheck },
  { href: "/admin/events", label: "Raw events", icon: Inbox },
  { href: "/admin/signals", label: "Signals", icon: ListChecks },
  { href: "/admin/sources", label: "Sources", icon: Radio },
  { href: "/admin/jobs", label: "Jobs", icon: Workflow },
  { href: "/admin/entitlements", label: "Entitlements", icon: ShieldCheck },
  { href: "/admin/affiliates", label: "Affiliates", icon: Link2 },
  { href: "/admin/audit", label: "Audit log", icon: FileClock },
];

function NavLinks({ isAdmin, onNavigate, reviewCount }: { isAdmin: boolean; onNavigate?: () => void; reviewCount?: number }) {
  const pathname = usePathname();
  const active = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(`${href}/`));
  const item = (l: (typeof MEMBER)[number], badge?: number) => (
    <Link
      key={l.href}
      href={l.href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground",
        active(l.href) && "bg-sidebar-accent font-medium text-sidebar-foreground",
      )}
    >
      <l.icon className={cn("size-4", active(l.href) && "text-primary")} />
      <span className="flex-1">{l.label}</span>
      {badge ? <span className="rounded-full bg-amber-400/15 px-1.5 text-[11px] font-medium text-amber-300">{badge}</span> : null}
    </Link>
  );
  return (
    <nav className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <div className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">Member</div>
        {MEMBER.map((l) => item(l))}
      </div>
      {isAdmin && (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
            <Cog className="size-3" /> Admin
          </div>
          {ADMIN.map((l) => item(l, l.href === "/admin/review" ? reviewCount : undefined))}
        </div>
      )}
      <div className="flex flex-col gap-0.5">
        <div className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">Public</div>
        {item({ href: "/pricing", label: "Pricing", icon: BarChart3 })}
      </div>
    </nav>
  );
}

export function Sidebar({ isAdmin, reviewCount, footer }: { isAdmin: boolean; reviewCount?: number; footer: React.ReactNode }) {
  return (
    <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r bg-sidebar p-3 lg:flex">
      <Brand href="/dashboard" className="px-2 py-2" />
      <div className="mt-4 flex-1 overflow-y-auto">
        <NavLinks isAdmin={isAdmin} reviewCount={reviewCount} />
      </div>
      {footer}
    </aside>
  );
}

export function MobileNav({ isAdmin, reviewCount, footer }: { isAdmin: boolean; reviewCount?: number; footer: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sticky top-0 z-30 flex items-center justify-between border-b bg-background/85 px-4 py-2.5 backdrop-blur lg:hidden">
      <Brand href="/dashboard" />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Open navigation" />}>
          <Menu />
        </SheetTrigger>
        <SheetContent side="left" className="w-72 bg-sidebar p-3">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Brand href="/dashboard" className="px-2 py-2" />
          <div className="mt-4 flex-1 overflow-y-auto">
            <NavLinks isAdmin={isAdmin} reviewCount={reviewCount} onNavigate={() => setOpen(false)} />
          </div>
          {footer}
        </SheetContent>
      </Sheet>
    </div>
  );
}
