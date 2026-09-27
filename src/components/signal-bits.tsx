import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fmtR } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, string> = {
  PENDING: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  ACTIVE: "border-primary/40 bg-primary/10 text-primary",
  PARTIAL: "border-primary/40 bg-primary/15 text-primary",
  WON: "border-win/30 bg-win/10 text-win",
  LOST: "border-loss/30 bg-loss/10 text-loss",
  BREAKEVEN: "border-border bg-muted text-muted-foreground",
  CANCELLED: "border-border bg-muted/60 text-muted-foreground",
  EXPIRED: "border-border bg-muted/60 text-muted-foreground",
  INVALID: "border-loss/30 bg-transparent text-loss",
  MANUAL_REVIEW: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  AMBIGUOUS: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  OPEN: "border-primary/40 bg-primary/10 text-primary",
};

const STATUS_LABEL: Record<string, string> = { MANUAL_REVIEW: "Ambiguous", BREAKEVEN: "Breakeven" };

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const label = STATUS_LABEL[status] ?? status.charAt(0) + status.slice(1).toLowerCase();
  return (
    <Badge variant="outline" className={cn("font-medium", STATUS_STYLE[status], className)}>
      {(status === "ACTIVE" || status === "PARTIAL") && <span className="size-1.5 animate-pulse rounded-full bg-current" />}
      {label}
    </Badge>
  );
}

export function DirectionBadge({ direction }: { direction: "LONG" | "SHORT" | string }) {
  const long = direction === "LONG";
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold tracking-wide", long ? "text-win" : "text-loss")}>
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

export function Stat({
  label,
  value,
  n,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  n?: number | null;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border bg-card/60 p-3", className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
      {(n !== undefined && n !== null) || hint ? (
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {n !== undefined && n !== null ? `n = ${n}` : null}
          {hint ? `${n !== undefined && n !== null ? " · " : ""}${hint}` : null}
        </div>
      ) : null}
    </div>
  );
}
