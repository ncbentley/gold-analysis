import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { loginAction } from "@/app/actions/auth";
import { AuthCard } from "@/components/auth-card";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/server/auth";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/dashboard";
  if (await getCurrentUser()) redirect(next.startsWith("/") ? next : "/dashboard");
  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to see live signals and source history."
      footer={
        <>
          New here? <Link href={`/signup${next !== "/dashboard" ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-primary hover:underline">Create an account</Link>
        </>
      }
    >
      <AuthForm
        action={loginAction}
        hidden={{ next }}
        submitLabel="Sign in"
        fields={[
          { name: "email", label: "Email", type: "email", autoComplete: "email", placeholder: "you@example.com" },
          { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
        ]}
      />
      <div className="mt-3 text-right text-xs">
        <Link href="/forgot-password" className="text-muted-foreground hover:text-foreground">Forgot password?</Link>
      </div>
      {process.env.NODE_ENV !== "production" && (
        <div className="mt-5 rounded-md border border-dashed p-3 text-[11px] leading-relaxed text-muted-foreground">
          <div className="mb-1 font-medium text-foreground">Local demo accounts</div>
          admin@example.com / admin12345
          <br />
          silver@, gold@, platinum@, free@example.com / demo12345
        </div>
      )}
    </AuthCard>
  );
}
