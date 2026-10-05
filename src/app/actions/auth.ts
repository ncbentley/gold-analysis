"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { trackEvent } from "@/server/analytics";
import { identifyAttribution } from "@/server/analytics/persist";
import {
  consumeToken,
  createSession,
  destroySession,
  getCurrentUser,
  hashPassword,
  issueToken,
  appUrl,
  sendEmail,
  sendVerificationEmail,
  verifyPassword,
} from "@/server/auth";
import { clientIp, rateLimit } from "@/server/auth/rate-limit";
import { getDb } from "@/server/db";
import { sessions, users } from "@/server/db/schema";

export type FormState = { error?: string; ok?: string } | undefined;

const credentials = z.object({
  email: z.email("Enter a valid email address").transform((s) => s.trim().toLowerCase()),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

function safeNext(next: FormDataEntryValue | null) {
  const s = typeof next === "string" ? next : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : "/dashboard";
}

async function limited(action: string, limit: number) {
  const ip = clientIp(await headers());
  return !rateLimit(`${action}:${ip}`, limit, 15 * 60_000).ok;
}

export async function signupAction(_: FormState, form: FormData): Promise<FormState> {
  if (await limited("signup", 10)) return { error: "Too many attempts. Try again in a few minutes." };
  const parsed = credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (form.get("terms") !== "on") return { error: "Please accept the terms to continue." };
  const db = await getDb();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, parsed.data.email));
  if (existing) return { error: "An account with this email already exists. Sign in instead." };
  const [user] = await db
    .insert(users)
    .values({ email: parsed.data.email, passwordHash: await hashPassword(parsed.data.password) })
    .returning();
  await sendVerificationEmail(user);
  await createSession(user.id);
  await identifyAttribution(user.id);
  await trackEvent("account_created", user.id);
  redirect(`/check-email?email=${encodeURIComponent(user.email)}`);
}

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  if (await limited("login", 20)) return { error: "Too many attempts. Try again in a few minutes." };
  const parsed = credentials.safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { error: "Invalid email or password." };
  const email = parsed.data.email;
  if (!rateLimit(`login-email:${email}`, 8, 15 * 60_000).ok) return { error: "Too many attempts for this account. Try again later." };
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) return { error: "Invalid email or password." };
  await createSession(user.id);
  await identifyAttribution(user.id);
  redirect(safeNext(form.get("next")));
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}

export async function resendVerificationAction(): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.emailVerifiedAt) return { ok: "Your email is already verified." };
  if (!rateLimit(`verify:${user.id}`, 3, 15 * 60_000).ok) return { error: "Please wait before requesting another email." };
  await sendVerificationEmail(user);
  redirect(`/check-email?email=${encodeURIComponent(user.email)}`);
}

export async function verifyEmail(token: string) {
  const userId = await consumeToken(token, "verify_email");
  if (!userId) return false;
  const db = await getDb();
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
  return true;
}

export async function forgotPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  if (await limited("forgot", 5)) return { error: "Too many requests. Try again later." };
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const db = await getDb();
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (user) {
    const token = await issueToken(user.id, "reset_password");
    await sendEmail(user.email, "Reset your password", `Reset your password (valid for 1 hour):\n${appUrl()}/reset-password?token=${token}`);
  }
  // Same response either way so the form cannot be used to discover accounts.
  redirect(`/check-email?email=${encodeURIComponent(email)}&kind=reset`);
}

export async function resetPasswordAction(_: FormState, form: FormData): Promise<FormState> {
  if (await limited("reset", 10)) return { error: "Too many attempts. Try again later." };
  const password = String(form.get("password") ?? "");
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  const userId = await consumeToken(String(form.get("token") ?? ""), "reset_password");
  if (!userId) return { error: "This reset link is invalid or has expired." };
  const db = await getDb();
  await db.update(users).set({ passwordHash: await hashPassword(password), emailVerifiedAt: new Date() }).where(eq(users.id, userId));
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await createSession(userId);
  redirect("/dashboard");
}
