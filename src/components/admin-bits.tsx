import { CheckCircle2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Icon = React.ComponentType<{ className?: string }>;

export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-9 w-full min-w-0 rounded-lg border border-input bg-[#081226] px-2.5 text-sm text-foreground outline-none transition-colors hover:border-glow/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Field({ label, htmlFor, hint, className, children }: { label: string; htmlFor?: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[11px] leading-snug text-muted-foreground/90">{hint}</p>}
    </div>
  );
}

export function Notice({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const notice = typeof searchParams.notice === "string" ? searchParams.notice : null;
  const error = typeof searchParams.error === "string" ? searchParams.error : null;
  if (!notice && !error) return null;
  return (
    <div
      role="status"
      className={cn(
        "mb-4 flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm font-medium",
        error ? "border-loss/45 bg-loss/10 text-loss shadow-[0_0_20px_-10px_var(--loss)]" : "border-win/40 bg-win/10 text-win shadow-[0_0_20px_-10px_var(--win)]",
      )}
    >
      {error ? <TriangleAlert className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
      <span>{error ?? notice}</span>
    </div>
  );
}

const CALLOUT: Record<"gold" | "warn" | "loss", { box: string; icon: string }> = {
  gold: { box: "border-primary/40 bg-primary/[0.06]", icon: "text-primary ring-primary/50 bg-primary/10" },
  warn: { box: "border-amber-400/35 bg-amber-400/[0.06] text-amber-100/90", icon: "text-amber-300 ring-amber-400/45 bg-amber-400/10" },
  loss: { box: "border-loss/40 bg-loss/10 text-loss", icon: "text-loss ring-loss/45 bg-loss/10" },
};

/** Inline status message with an icon tile, for conditions an operator should act on. */
export function Callout({ tone = "gold", icon: IconCmp = TriangleAlert, className, children }: { tone?: keyof typeof CALLOUT; icon?: Icon; className?: string; children: React.ReactNode }) {
  const t = CALLOUT[tone];
  return (
    <div className={cn("flex items-start gap-3 rounded-xl border px-3.5 py-3 text-sm", t.box, className)}>
      <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg ring-1", t.icon)}>
        <IconCmp className="size-4" />
      </span>
      <div className="min-w-0 self-center">{children}</div>
    </div>
  );
}

export function EmptyState({ icon: IconCmp, action, className, children }: { icon?: Icon; action?: React.ReactNode; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col items-center gap-3 rounded-xl border border-dashed border-glow/30 bg-glow/[0.03] px-6 py-10 text-center text-sm text-muted-foreground", className)}>
      {IconCmp && (
        <span className="flex size-11 items-center justify-center rounded-full bg-glow/10 text-[#8db6ff] ring-1 ring-glow/40">
          <IconCmp className="size-5" />
        </span>
      )}
      <p className="max-w-md text-pretty">{children}</p>
      {action}
    </div>
  );
}

export function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre className={cn("max-h-80 overflow-auto rounded-lg border border-glow/20 bg-[#050b18] p-3 font-mono text-[11px] leading-relaxed text-[#b7c6e2]", className)}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

const PARSE_STYLE: Record<string, string> = {
  applied: "border-win/45 bg-win/10 text-win",
  resolved: "border-win/45 bg-win/10 text-win",
  needs_review: "border-amber-400/45 bg-amber-400/10 text-amber-300",
  failed: "border-loss/45 bg-loss/10 text-loss",
  ignored: "border-border bg-muted/60 text-muted-foreground",
  superseded: "border-border bg-muted/60 text-muted-foreground",
  queued: "border-glow/50 bg-glow/10 text-[#8db6ff]",
  importing: "border-primary/50 bg-primary/10 text-primary",
  caught_up: "border-win/45 bg-win/10 text-win",
  running: "border-primary/50 bg-primary/10 text-primary",
  succeeded: "border-win/45 bg-win/10 text-win",
};

export function StateBadge({ state }: { state: string | null | undefined }) {
  if (!state) return <span className="text-xs text-muted-foreground">—</span>;
  const live = state === "importing" || state === "running";
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold", PARSE_STYLE[state])}>
      <span className={cn("size-1.5 rounded-full bg-current", live && "animate-pulse motion-reduce:animate-none")} />
      {state.replace("_", " ")}
    </span>
  );
}

export function FilterLinks({ base, param, options, current }: { base: string; param: string; options: { value: string; label: string; count?: number }[]; current?: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = (current ?? "") === o.value;
        const href = o.value ? `${base}?${param}=${encodeURIComponent(o.value)}` : base;
        return (
          <Link
            key={o.value || "all"}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium outline-none transition-all duration-200 focus-visible:ring-3 focus-visible:ring-ring/50",
              active
                ? "gold-fill border-transparent font-semibold shadow-[0_0_16px_-4px_rgb(245_197_66/0.65)]"
                : "border-glow/35 bg-[#0a1630]/80 text-foreground/80 hover:border-glow/70 hover:text-foreground",
            )}
          >
            {o.label}
            {o.count !== undefined && (
              <span className={cn("rounded-full px-1.5 font-mono text-[10px] tabular-nums", active ? "bg-primary-foreground/15" : "bg-glow/15 text-[#8db6ff]")}>{o.count}</span>
            )}
          </Link>
        );
      })}
    </div>
  );
}

export const toInputDateTime = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 16) : "");
