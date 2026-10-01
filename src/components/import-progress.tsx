"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Reloads the server page while a source is queued or importing. */
export function ImportProgressRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(id);
  }, [active, router]);
  return null;
}
