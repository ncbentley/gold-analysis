import { ScrollText, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";

export function LegalPage({ title, updated, sections }: { title: string; updated: string; sections: { heading: string; body: string[] }[] }) {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:py-10">
      <PageHeader icon={ScrollText} title={title} description={`Last updated ${updated}`} size="sm" />
      <article className="panel rounded-2xl p-5 shadow-[0_0_28px_-12px_rgb(47_123_255/0.55)] ring-1 ring-glow/30 md:p-8">
        <div className="flex gap-2.5 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3 text-xs text-amber-200/90">
          <TriangleAlert className="mt-px size-4 shrink-0" />
          This is a working template for the MVP. It must be reviewed by qualified counsel for your jurisdiction before launch.
        </div>
        <div className="mt-8 max-w-[70ch] space-y-8">
          {sections.map((s) => (
            <section key={s.heading}>
              <h2 className="flex items-center gap-2.5 font-heading text-lg font-bold tracking-tight">
                <span className="h-4 w-1 rounded-full bg-primary shadow-[0_0_10px_rgb(245_197_66/0.6)]" />
                {s.heading}
              </h2>
              {s.body.map((p, i) => (
                <p key={i} className="mt-2 leading-relaxed text-foreground/75">
                  {p}
                </p>
              ))}
            </section>
          ))}
        </div>
      </article>
    </div>
  );
}
