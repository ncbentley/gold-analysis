import type { Metadata } from "next";
import { requireAdmin } from "@/server/auth/guards";

export const metadata: Metadata = { title: { template: "%s · Admin · Gold Intelligence Gateway", default: "Admin" } };

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  await requireAdmin();
  return children;
}
