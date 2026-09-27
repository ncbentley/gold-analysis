import type { Metadata } from "next";
import { resetPasswordAction } from "@/app/actions/auth";
import { AuthCard } from "@/components/auth-card";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  return (
    <AuthCard title="Choose a new password" description="Other sessions will be signed out.">
      <AuthForm
        action={resetPasswordAction}
        hidden={{ token }}
        submitLabel="Update password"
        fields={[{ name: "password", label: "New password", type: "password", autoComplete: "new-password", placeholder: "At least 8 characters" }]}
      />
    </AuthCard>
  );
}
