import type { Metadata } from "next";
import Link from "next/link";
import { verifyEmail } from "@/app/actions/auth";
import { AuthCard } from "@/components/auth-card";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Verify email" };

export default async function VerifyPage({ searchParams }: PageProps<"/verify">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const ok = token ? await verifyEmail(token) : false;
  return (
    <AuthCard
      title={ok ? "Email verified" : "Link invalid or expired"}
      description={ok ? "Thanks, your email address is confirmed. You can now start a membership." : "Request a new link from your dashboard."}
    >
      <Link href={ok ? "/pricing" : "/dashboard"} className={buttonVariants({ className: "w-full" })}>
        {ok ? "Choose a plan" : "Go to dashboard"}
      </Link>
    </AuthCard>
  );
}
