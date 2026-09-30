import Image from "next/image";
import { cn } from "@/lib/utils";

type Icon = React.ComponentType<{ className?: string }>;

const ART = { gold: "/brand/hero-gold.jpg", bull: "/brand/hero-bull.jpg" } as const;

/**
 * Page hero banner. `size="sm"` is the slim variant for dense tool pages.
 * `features` renders the row of gold-ringed icon chips under the description.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
  icon: IconCmp,
  features,
  art = "gold",
  size = "lg",
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  icon?: Icon;
  features?: { icon: Icon; label: React.ReactNode }[];
  art?: keyof typeof ART | "none";
  size?: "lg" | "sm";
  children?: React.ReactNode;
}) {
  const lg = size === "lg";
  return (
    <section
      className={cn(
        "relative isolate mb-5 overflow-hidden rounded-2xl bg-[#060d1f] shadow-[0_0_36px_-12px_rgb(245_197_66/0.55)] ring-1 ring-primary/35",
        lg ? "min-h-52" : "min-h-28",
        className,
      )}
    >
      {art !== "none" && (
        <Image src={ART[art]} alt="" fill loading="eager" fetchPriority="high" sizes="(min-width: 1024px) 1200px, 100vw" className="-z-10 object-cover object-[80%_50%] opacity-90" />
      )}
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#040914] from-25% via-[#040914]/80 via-55% to-[#040914]/10 max-md:via-[#040914]/90" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-px bg-gradient-to-r from-primary/0 via-primary/70 to-primary/0" />
      <div className={cn("flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between", lg ? "px-5 py-7 md:px-8 md:py-9" : "px-5 py-5 md:px-7")}>
        <div className="min-w-0 max-w-2xl">
          <div className="flex items-center gap-3.5">
            {IconCmp && (
              <span
                className={cn(
                  "flex shrink-0 items-center justify-center rounded-full bg-black/40 text-primary shadow-[0_0_18px_-2px_rgb(245_197_66/0.6)] ring-2 ring-primary/70",
                  lg ? "size-14" : "size-10",
                )}
              >
                <IconCmp className={lg ? "size-7" : "size-5"} />
              </span>
            )}
            <h1
              className={cn(
                "gold-text font-heading font-extrabold tracking-tight drop-shadow-[0_2px_12px_rgb(245_197_66/0.25)]",
                lg ? "text-4xl leading-[1.05] md:text-5xl" : "text-2xl md:text-3xl",
              )}
            >
              {title}
            </h1>
          </div>
          {description && <p className={cn("mt-3 max-w-xl text-pretty text-foreground/85", lg ? "text-base leading-relaxed" : "text-sm")}>{description}</p>}
          {features && features.length > 0 && (
            <ul className="mt-5 flex flex-wrap gap-x-6 gap-y-3">
              {features.map((f, i) => (
                <li key={i} className="flex items-center gap-2.5">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-black/45 text-primary ring-1 ring-primary/60">
                    <f.icon className="size-5" />
                  </span>
                  <span className="max-w-32 text-xs font-medium leading-tight text-foreground/90">{f.label}</span>
                </li>
              ))}
            </ul>
          )}
          {children}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </section>
  );
}

/** Section heading used inside pages, with an optional right-aligned link or control. */
export function SectionTitle({ icon: IconCmp, title, action, className }: { icon?: Icon; title: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3", className)}>
      <h2 className="flex items-center gap-2 font-heading text-lg font-bold tracking-tight">
        {IconCmp && <IconCmp className="size-5 text-primary" />}
        {title}
      </h2>
      {action}
    </div>
  );
}
