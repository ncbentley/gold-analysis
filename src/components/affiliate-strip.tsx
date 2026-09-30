import { ExternalLink, Handshake } from "lucide-react";
import { linksForPlacement, type Placement } from "@/server/affiliates";

export async function AffiliateStrip({ placement }: { placement: Placement }) {
  const links = await linksForPlacement(placement);
  if (!links.length) return null;
  return (
    <section aria-labelledby={`brokers-${placement}`} className="panel rounded-2xl p-4 shadow-[0_0_28px_-12px_rgb(47_123_255/0.6)] ring-1 ring-glow/30 md:p-5">
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/55">
          <Handshake className="size-5" />
        </span>
        <div>
          <h2 id={`brokers-${placement}`} className="gold-text font-heading text-lg font-extrabold tracking-tight">Broker partners</h2>
          <p className="text-xs text-muted-foreground">Open an account with a broker through these links.</p>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {links.map((l) => (
          <a
            key={l.id}
            href={`/go/${l.slug}`}
            rel="sponsored noopener"
            target="_blank"
            className="group flex items-center justify-between gap-2 rounded-xl bg-[#0a1630]/80 px-3.5 py-3 text-sm font-semibold ring-1 ring-glow/35 transition-all duration-200 hover:ring-primary/60 hover:shadow-[0_0_18px_-6px_rgb(245_197_66/0.6)] focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="truncate">{l.name}</span>
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
          </a>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{links[0].disclosure}</p>
    </section>
  );
}
