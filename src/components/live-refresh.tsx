"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Reloads the server page so a signal written by PROCESS_EVENT shows up
 * without waiting for AI_ANALYZE_SIGNAL. Hidden tabs do not refresh.
 */
export function LiveRefresh({ intervalMs = 1000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, router]);
  return null;
}
