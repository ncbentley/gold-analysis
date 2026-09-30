import Image from "next/image";
import Link from "next/link";
import { BrandLockup } from "@/components/brand";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="relative isolate flex min-h-svh flex-col items-center justify-center overflow-hidden px-4 py-16 text-center">
      <Image src="/brand/hero-gold.jpg" alt="" fill loading="eager" sizes="100vw" className="-z-10 object-cover object-[78%_50%] opacity-40" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_55%_50%_at_50%_45%,rgb(4_9_20/0.6),rgb(4_9_20/0.94))]" />
      <BrandLockup />
      <p className="gold-text mt-10 font-heading text-8xl font-extrabold leading-none tracking-tight drop-shadow-[0_4px_24px_rgb(245_197_66/0.35)] md:text-9xl" aria-hidden>
        404
      </p>
      <h1 className="mt-4 font-heading text-2xl font-bold tracking-tight">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-foreground/75">The page you were looking for doesn’t exist or you don’t have access to it.</p>
      <div className="mt-7 flex gap-2.5">
        <Link href="/" className={buttonVariants({ variant: "outline", size: "lg" })}>
          Home
        </Link>
        <Link href="/dashboard" className={buttonVariants({ size: "lg" })}>
          Dashboard
        </Link>
      </div>
    </div>
  );
}
