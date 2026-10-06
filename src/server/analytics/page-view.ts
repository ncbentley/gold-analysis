export function acceptPagePath(pathname: unknown): string | null {
  if (typeof pathname !== "string") return null;
  if (!pathname.startsWith("/")) return null;
  if (pathname.includes("?") || pathname.includes("\\") || pathname.includes("://")) return null;
  if (pathname === "/admin" || pathname === "/api" || pathname.startsWith("/admin/") || pathname.startsWith("/api/")) return null;
  return pathname;
}
