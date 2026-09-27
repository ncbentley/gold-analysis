import { CheckCircle2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "h-8 w-full min-w-0 rounded-lg border border-input bg-input/30 px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
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
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
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
        "mb-4 flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
        error ? "border-loss/40 bg-loss/10 text-loss" : "border-win/30 bg-win/10 text-win",
      )}
    >
      {error ? <TriangleAlert className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}
      <span>{error ?? notice}</span>
    </div>
  );
}

export function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre className={cn("max-h-80 overflow-auto rounded-md border bg-background/60 p-3 font-mono text-[11px] leading-relaxed text-muted-foreground", className)}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

const PARSE_STYLE: Record<string, string> = {
  applied: "text-win border-win/30",
  resolved: "text-win border-win/30",
  needs_review: "text-amber-300 border-amber-400/40",
  failed: "text-loss border-loss/40",
  ignored: "text-muted-foreground",
  superseded: "text-muted-foreground",
  queued: "text-sky-300 border-sky-400/30",
  running: "text-primary border-primary/40",
  succeeded: "text-win border-win/30",
};

export function StateBadge({ state }: { state: string | null | undefined }) {
  if (!state) return <span className="text-xs text-muted-foreground">—</span>;
  return <span className={cn("inline-flex rounded-md border px-1.5 py-0.5 text-[11px] font-medium", PARSE_STYLE[state])}>{state.replace("_", " ")}</span>;
}

export function FilterLinks({ base, param, options, current }: { base: string; param: string; options: { value: string; label: string; count?: number }[]; current?: string }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = (current ?? "") === o.value;
        const href = o.value ? `${base}?${param}=${encodeURIComponent(o.value)}` : base;
        return (
          <Link
            key={o.value || "all"}
            href={href}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs transition-colors",
              active ? "border-primary/50 bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
            {o.count !== undefined && <span className="ml-1 opacity-70">{o.count}</span>}
          </Link>
        );
      })}
    </div>
  );
}

export const toInputDateTime = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 16) : "");
