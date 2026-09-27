import { desc, eq } from "drizzle-orm";
import { MailCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard } from "@/components/auth-card";
import { buttonVariants } from "@/components/ui/button";
import { devMailboxEnabled } from "@/server/auth";
import { getDb } from "@/server/db";
import { outboundEmails } from "@/server/db/schema";

export const metadata: Metadata = { title: "Check your email" };

export default async function CheckEmailPage({ searchParams }: PageProps<"/check-email">) {
  const sp = await searchParams;
  const email = typeof sp.email === "string" ? sp.email : "";
  const reset = sp.kind === "reset";
  let devLink: string | null = null;
  if (devMailboxEnabled() && email) {
    const db = await getDb();
    const [latest] = await db.select().from(outboundEmails).where(eq(outboundEmails.to, email)).orderBy(desc(outboundEmails.createdAt)).limit(1);
    devLink = latest?.body.match(/https?:\/\/\S+/)?.[0] ?? null;
    if (devLink) devLink = devLink.replace(/^https?:\/\/[^/]+/, "");
  }
  return (
    <AuthCard
      title="Check your email"
      description={
        reset
          ? "If an account exists for that address, we sent a password reset link. It expires in one hour."
          : sp.reason === "checkout"
            ? "Verify your email before starting a membership. We sent a confirmation link."
            : "We sent a confirmation link to verify your email address."
      }
    >
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MailCheck />
        </div>
        {email && <div className="text-sm font-medium">{email}</div>}
        {devLink && (
          <div className="w-full rounded-md border border-dashed p-3 text-left text-xs text-muted-foreground">
            <div className="mb-1 font-medium text-foreground">Local dev mailbox</div>
            Emails are not sent in local development.{" "}
            <Link href={devLink} className="text-primary underline-offset-2 hover:underline">Open the link from this email</Link>.
          </div>
        )}
        <Link href="/dashboard" className={buttonVariants({ variant: "outline", className: "w-full" })}>Continue to dashboard</Link>
      </div>
    </AuthCard>
  );
}
