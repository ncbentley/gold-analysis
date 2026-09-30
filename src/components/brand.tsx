import Link from "next/link";
import { cn } from "@/lib/utils";

const GOLD = "url(#gig-gold)";

/** Shared gradient for every BrandMark. Rendered once in the root layout; gradients inside display:none subtrees don't paint. */
export function BrandDefs() {
  return (
    <svg aria-hidden width="0" height="0" className="absolute">
      <defs>
        <linearGradient id="gig-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3c4" />
          <stop offset="0.45" stopColor="#f5c542" />
          <stop offset="1" stopColor="#b97c12" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 48" aria-hidden className={cn("h-8 w-auto", className)}>
      <path d="M22 13 L25 4 L29.5 9 L32 2 L34.5 9 L39 4 L42 13 Z" fill={GOLD} />
      <rect x="22" y="13.5" width="20" height="2.2" rx="1" fill={GOLD} />
      <text
        x="32"
        y="44"
        textAnchor="middle"
        fontSize="30"
        fontWeight="700"
        letterSpacing="-1"
        fill={GOLD}
        stroke="#3a2705"
        strokeWidth="0.6"
        style={{ fontFamily: "var(--font-cinzel), serif" }}
      >
        GIG
      </text>
    </svg>
  );
}

function Wordmark({ size = "sm" }: { size?: "sm" | "lg" }) {
  return (
    <span className={cn("flex flex-col leading-none", size === "lg" && "items-center")}>
      <span className={cn("gold-text font-brand font-bold tracking-tight", size === "lg" ? "text-[1.05rem]" : "text-[0.95rem]")}>Gold Intelligence</span>
      <span className={cn("mt-1 font-brand font-semibold tracking-[0.42em] text-primary/80", size === "lg" ? "text-[0.62rem]" : "text-[0.55rem]")}>GATEWAY</span>
    </span>
  );
}

export function Brand({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} aria-label="Gold Intelligence Gateway home" className={cn("flex items-center gap-2.5", className)}>
      <BrandMark />
      <Wordmark />
    </Link>
  );
}

/** Stacked lockup for the sidebar head. */
export function BrandLockup({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} aria-label="Gold Intelligence Gateway home" className={cn("flex flex-col items-center gap-1.5", className)}>
      <BrandMark className="h-12 drop-shadow-[0_0_12px_rgb(245_197_66/0.45)]" />
      <Wordmark size="lg" />
    </Link>
  );
}
