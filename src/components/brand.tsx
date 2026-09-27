import Link from "next/link";
import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn("size-7", className)}>
      <defs>
        <linearGradient id="bm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="oklch(0.9 0.1 90)" />
          <stop offset="1" stopColor="oklch(0.7 0.14 75)" />
        </linearGradient>
      </defs>
      <path d="M6 22 L11 10 H21 L26 22 Z" fill="url(#bm)" />
      <path d="M11 10 L13.5 22 M21 10 L18.5 22" stroke="oklch(0.25 0.03 70)" strokeWidth="1.2" opacity="0.5" />
      <rect x="4" y="23" width="24" height="3" rx="1" fill="oklch(0.78 0.12 82)" />
    </svg>
  );
}

export function Brand({ href = "/", className }: { href?: string; className?: string }) {
  return (
    <Link href={href} className={cn("flex items-center gap-2 font-semibold tracking-tight", className)}>
      <BrandMark />
      <span>
        Aurum <span className="gold-text">Ledger</span>
      </span>
    </Link>
  );
}
