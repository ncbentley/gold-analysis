"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/auth/guards";
import { parseViewAs, VIEW_AS_COOKIE } from "@/server/entitlements/view-as";

export async function setViewAsAction(form: FormData) {
  await requireAdmin();
  const level = String(form.get("level") ?? "");
  const jar = await cookies();
  const viewAs = level === "admin" ? null : parseViewAs(level);
  if (level !== "admin" && !viewAs) throw new Error("Unknown membership level.");
  if (!viewAs) {
    jar.delete(VIEW_AS_COOKIE);
  } else {
    jar.set(VIEW_AS_COOKIE, viewAs, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 12 * 60 * 60,
    });
  }
  const back = String(form.get("return") ?? "/dashboard");
  redirect(back.startsWith("/") && !back.startsWith("//") ? back : "/dashboard");
}
