"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refreshes the server page only after the queue writes a new dashboard label. */
export function FeedRefresh() {
  const router = useRouter();
  useEffect(() => {
    const source = new EventSource("/api/feed/stream");
    let opened = false;
    source.onmessage = () => {
      if (!opened) {
        opened = true;
        return;
      }
      router.refresh();
    };
    return () => source.close();
  }, [router]);
  return null;
}
