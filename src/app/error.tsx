"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import { BrandMark } from "@/components/brand";
import { Button } from "@/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60svh] items-center justify-center px-4 py-12">
      <div className="panel w-full max-w-md rounded-2xl p-7 text-center shadow-[0_0_36px_-12px_rgb(245_197_66/0.5)] ring-1 ring-primary/35">
        <BrandMark className="mx-auto h-9 opacity-90" />
        <div className="mx-auto mt-5 flex size-12 items-center justify-center rounded-full bg-loss/10 text-loss ring-1 ring-loss/50">
          <TriangleAlert className="size-6" />
        </div>
        <h1 className="mt-4 font-heading text-xl font-bold tracking-tight">Something went wrong</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          The page could not be loaded. Nothing you entered has been lost; try again, and if it keeps happening contact support
          {error.digest ? ` with reference ${error.digest}` : ""}.
        </p>
        <Button className="mt-6" size="lg" onClick={reset}>
          <RotateCcw />
          Try again
        </Button>
      </div>
    </div>
  );
}
