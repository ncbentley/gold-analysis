import { ExternalLink } from "lucide-react";
import { linksForPlacement, type Placement } from "@/server/affiliates";

export async function AffiliateStrip({ placement }: { placement: Placement }) {
  const links = await linksForPlacement(placement);
  if (!links.length) return null;
  return (
    <div className="rounded-lg border bg-card/40 p-4">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Brokers</div>
      <div className="mt-2 flex flex-wrap gap-2">
        {links.map((l) => (
          <a
            key={l.id}
            href={`/go/${l.slug}`}
            rel="sponsored noopener"
            target="_blank"
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm hover:border-primary/40 hover:text-primary"
          >
            {l.name} <ExternalLink className="size-3" />
          </a>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{links[0].disclosure}</p>
    </div>
  );
}
