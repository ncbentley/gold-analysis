import Link from "next/link";
import { DirectionBadge } from "@/components/signal-bits";
import { Badge } from "@/components/ui/badge";
import { fmtEntry, fmtPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BoardCard } from "@/server/board/service";
import type { IdeaPhase } from "@/server/ideas/phase";

const PHASE_LABEL: Record<IdeaPhase, string> = {
  available: "Available",
  "playing-out": "Playing out",
  history: "History",
};

const PHASE_STYLE: Record<IdeaPhase, string> = {
  available: "border-glow/50 bg-glow/10 text-[#8db6ff]",
  "playing-out": "border-primary/50 bg-primary/10 text-primary",
  history: "border-border bg-muted/60 text-muted-foreground",
};

function hrefFor(card: BoardCard) {
  return `/board/${card.postId}?pick=${card.slot}`;
}

function PickCard({ card, featured }: { card: BoardCard; featured?: boolean }) {
  return (
    <Link
      href={hrefFor(card)}
      className={cn(
        "group block rounded-2xl p-4 ring-1 ring-glow/30 outline-none transition hover:ring-primary/55 focus-visible:ring-2 focus-visible:ring-ring",
        featured ? "panel-gold shadow-[0_0_28px_-8px_rgb(245_197_66/0.55)]" : "panel shadow-[0_0_28px_-10px_rgb(47_123_255/0.55)]",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <DirectionBadge direction={card.pick.direction} />
        <Badge variant="outline" className={cn("rounded-md font-semibold", PHASE_STYLE[card.phase])}>
          {PHASE_LABEL[card.phase]}
        </Badge>
        {featured && <span className="text-xs font-semibold uppercase tracking-wide text-primary">Primary</span>}
      </div>
      <div className={cn("mt-3 font-heading font-extrabold tabular-nums tracking-tight", featured ? "gold-text text-3xl" : "text-xl")}>
        {fmtEntry(card.pick.entryMin, card.pick.entryMax)}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>Stop {card.pick.stopLoss === null ? "—" : fmtPrice(card.pick.stopLoss)}</span>
        <span>{card.pick.targets.length ? card.pick.targets.map((price) => fmtPrice(price)).join(" · ") : "No targets"}</span>
      </div>
      <p className="mt-3 line-clamp-3 text-sm text-foreground/85">{card.pick.writeup}</p>
    </Link>
  );
}

export function BoardPicks({ items, empty }: { items: BoardCard[]; empty?: string }) {
  if (!items.length) {
    return (
      <div className="rounded-xl border border-dashed border-glow/30 bg-glow/[0.03] px-6 py-10 text-center text-sm text-muted-foreground">
        {empty ?? "No board yet."}
      </div>
    );
  }
  const [first, ...rest] = items;
  const featured = first.slot === "primary";
  return (
    <div className="space-y-3">
      <PickCard card={first} featured={featured} />
      {rest.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {rest.map((card) => (
            <PickCard key={`${card.postId}-${card.slot}`} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}
