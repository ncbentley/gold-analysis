import { BadgeCheck, MailX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { verifyEmail } from "@/app/actions/auth";
import { AuthCard } from "@/components/auth-card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Verify email" };

export default async function VerifyPage({ searchParams }: PageProps<"/verify">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const ok = token ? await verifyEmail(token) : false;
  const StateIcon = ok ? BadgeCheck : MailX;
  return (
    <AuthCard
      title={ok ? "Email verified" : "Link invalid or expired"}
      description={ok ? "Thanks, your email address is confirmed. You can now start a membership." : "Request a new link from your dashboard."}
    >
      <div className="flex flex-col items-center gap-4">
        <div
          className={cn(
            "flex size-14 items-center justify-center rounded-full bg-black/40 ring-2",
            ok ? "text-win shadow-[0_0_18px_-2px_var(--win)] ring-win/60" : "text-loss shadow-[0_0_18px_-4px_var(--loss)] ring-loss/55",
          )}
        >
          <StateIcon className="size-6" />
        </div>
        <Link href={ok ? "/billing#plans" : "/dashboard"} className={buttonVariants({ size: "lg", className: "w-full" })}>
          {ok ? "Choose a plan" : "Go to dashboard"}
        </Link>
      </div>
    </AuthCard>
  );
}
