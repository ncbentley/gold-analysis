import { ArrowDownRight, ArrowUpRight, Gem, Medal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fmtR } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Tier } from "@/server/db/schema";

export const TIER_ICON: Record<Tier, React.ComponentType<{ className?: string }>> = { silver: Medal, gold: Gem };

const STATUS_STYLE: Record<string, string> = {
  PENDING: "border-glow/50 bg-glow/10 text-[#8db6ff]",
  ACTIVE: "border-primary/50 bg-primary/10 text-primary",
  PARTIAL: "border-primary/50 bg-primary/15 text-primary",
  WON: "border-win/45 bg-win/10 text-win",
  LOST: "border-loss/45 bg-loss/10 text-loss",
  BREAKEVEN: "border-border bg-muted text-muted-foreground",
  CANCELLED: "border-border bg-muted/60 text-muted-foreground",
  EXPIRED: "border-border bg-muted/60 text-muted-foreground",
  INVALID: "border-loss/30 bg-transparent text-loss",
  MANUAL_REVIEW: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  AMBIGUOUS: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  OPEN: "border-primary/50 bg-primary/10 text-primary",
};

const STATUS_LABEL: Record<string, string> = { MANUAL_REVIEW: "Ambiguous", BREAKEVEN: "Breakeven" };

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const label = STATUS_LABEL[status] ?? status.charAt(0) + status.slice(1).toLowerCase();
  return (
    <Badge variant="outline" className={cn("rounded-md font-semibold", STATUS_STYLE[status], className)}>
      {(status === "ACTIVE" || status === "PARTIAL") && <span className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />}
      {label}
    </Badge>
  );
}

export function DirectionBadge({ direction }: { direction: "LONG" | "SHORT" | string }) {
  const long = direction === "LONG";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-bold tracking-wide",
        long ? "border-win/50 bg-win/10 text-win shadow-[0_0_10px_-3px_var(--win)]" : "border-loss/50 bg-loss/10 text-loss shadow-[0_0_10px_-3px_var(--loss)]",
      )}
    >
      {long ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {long ? "LONG" : "SHORT"}
    </span>
  );
}

export function RValue({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined) return <span className={cn("text-muted-foreground", className)}>—</span>;
  return (
    <span className={cn("font-mono tabular-nums", value > 0.05 ? "text-win" : value < -0.05 ? "text-loss" : "text-muted-foreground", className)}>
      {fmtR(value)}
    </span>
  );
}

const TONE: Record<"blue" | "gold" | "win" | "loss", { ring: string; icon: string }> = {
  blue: { ring: "ring-glow/35 shadow-[0_0_22px_-10px_rgb(47_123_255/0.7)]", icon: "text-[#8db6ff] ring-glow/50 bg-glow/10" },
  gold: { ring: "ring-primary/45 shadow-[0_0_22px_-8px_rgb(245_197_66/0.6)]", icon: "text-primary ring-primary/55 bg-primary/10" },
  win: { ring: "ring-win/35 shadow-[0_0_22px_-10px_var(--win)]", icon: "text-win ring-win/50 bg-win/10" },
  loss: { ring: "ring-loss/35 shadow-[0_0_22px_-10px_var(--loss)]", icon: "text-loss ring-loss/50 bg-loss/10" },
};

export function Stat({
  label,
  value,
  n,
  hint,
  className,
  icon: IconCmp,
  tone = "blue",
}: {
  label: string;
  value: React.ReactNode;
  n?: number | null;
  hint?: string;
  className?: string;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: keyof typeof TONE;
}) {
  const t = TONE[tone];
  return (
    <div className={cn("panel flex items-center gap-3 rounded-xl p-3.5 ring-1", t.ring, className)}>
      {IconCmp && (
        <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-xl ring-1", t.icon)}>
          <IconCmp className="size-5" />
        </span>
      )}
      <div className="min-w-0">
        <div className="text-xs font-medium text-muted-foreground">{label}</div>
        <div className={cn("mt-0.5 font-heading text-2xl font-bold tabular-nums tracking-tight", tone === "gold" && "gold-text")}>{value}</div>
        {(n !== undefined && n !== null) || hint ? (
          <div className="mt-0.5 text-[11px] text-muted-foreground">
            {n !== undefined && n !== null ? `n = ${n}` : null}
            {hint ? `${n !== undefined && n !== null ? " · " : ""}${hint}` : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
