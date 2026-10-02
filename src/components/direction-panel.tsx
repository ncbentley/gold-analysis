import { Compass } from "lucide-react";
import { SectionTitle } from "@/components/page-header";
import { fmtAge, fmtPrice } from "@/lib/format";
import type { DirectionView } from "@/server/direction/service";
import { cn } from "@/lib/utils";

const LEAN_CLASS = {
  bid: "text-primary",
  defensive: "text-amber-200",
  offered: "text-[#8db6ff]",
} as const;

export function DirectionPanel({
  direction,
  now,
  empty,
}: {
  direction: DirectionView | null;
  now: number;
  empty: string;
}) {
  return (
    <section>
      <SectionTitle icon={Compass} title="Market direction" />
      {!direction ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="rounded-xl bg-[#081226] p-4 ring-1 ring-primary/35">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className={cn("font-heading text-2xl font-extrabold tracking-tight", LEAN_CLASS[direction.lean])}>{direction.label}</div>
            <div className="text-xs text-muted-foreground">
              {direction.spot !== null && <span className="mr-3 font-mono text-foreground/80">XAU/USD {fmtPrice(direction.spot)}</span>}
              Updated {fmtAge(direction.createdAt, now)} ago
            </div>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed">{direction.summary}</p>
          {direction.headlines.length > 0 && (
            <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              {direction.headlines.slice(0, 6).map((headline) => (
                <li key={`${headline.sourceId}-${headline.publishedAt}`}>
                  <span className="font-medium text-foreground/80">{headline.sourceName}.</span> {headline.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
