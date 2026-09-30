import Image from "next/image";
import { BrandLockup } from "@/components/brand";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function AuthCard({ title, description, children, footer }: { title: string; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="relative isolate flex min-h-[calc(100svh-4rem)] items-start justify-center overflow-hidden px-4 py-12 md:py-16">
      <Image src="/brand/hero-gold.jpg" alt="" fill loading="eager" sizes="100vw" className="-z-10 object-cover object-[78%_50%] opacity-45" />
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_60%_55%_at_50%_40%,rgb(4_9_20/0.55),rgb(4_9_20/0.92))]" />
      <div className="w-full max-w-sm">
        <BrandLockup className="mb-6" />
        <Card className="rounded-2xl bg-[#0a1428]/85 shadow-[0_0_44px_-10px_rgb(245_197_66/0.45)] ring-primary/40 backdrop-blur-md [--card-spacing:--spacing(6)]">
          <CardHeader className="text-center">
            <CardTitle className="gold-text text-2xl font-extrabold">{title}</CardTitle>
            {description && <CardDescription className="text-pretty">{description}</CardDescription>}
          </CardHeader>
          <CardContent>
            {children}
            {footer && <div className="mt-5 border-t border-glow/15 pt-4 text-center text-sm text-muted-foreground">{footer}</div>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
