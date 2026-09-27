import Link from "next/link";
import { BrandMark } from "@/components/brand";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="grid-bg flex min-h-svh flex-col items-center justify-center px-4 text-center">
      <BrandMark className="size-10" />
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">The page you were looking for doesn’t exist or you don’t have access to it.</p>
      <div className="mt-6 flex gap-2">
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          Home
        </Link>
        <Link href="/dashboard" className={buttonVariants()}>
          Dashboard
        </Link>
      </div>
    </div>
  );
}
