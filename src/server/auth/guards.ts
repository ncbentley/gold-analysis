import { notFound, redirect } from "next/navigation";
import type { Actor } from "@/server/audit";
import { getCurrentUser } from "./index";

export async function requireUser(next?: string) {
  const user = await getCurrentUser();
  if (!user) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return user;
}

/** Server-side admin check. Used by every admin page and every admin action. */
export async function requireAdmin(): Promise<{ user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>; actor: Actor }> {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") notFound();
  return { user, actor: { userId: user.id, label: user.email } };
}
