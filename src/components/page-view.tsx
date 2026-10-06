"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export function PageView() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!pathname || last.current === pathname) return;
    last.current = pathname;
    void fetch("/api/analytics/page", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pathname }),
      keepalive: true,
    });
  }, [pathname]);
  return null;
}
