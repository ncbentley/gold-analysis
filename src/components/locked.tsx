import { Lock } from "lucide-react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { trackEvent } from "@/server/analytics";
import { TIER_LABEL } from "@/server/entitlements/config";
import type { Gated } from "@/server/entitlements/access";

export function LockedPanel({
  feature,
  requiredTier,
  title,
  userId,
  className,
  compact,
}: {
  feature: string;
  requiredTier: string | null;
  title?: string;
  userId?: string | null;
  className?: string;
  compact?: boolean;
}) {
  void trackEvent("locked_section_viewed", userId ?? null, { feature, requiredTier });
  const tierLabel = requiredTier ? TIER_LABEL[requiredTier as keyof typeof TIER_LABEL] : null;
  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center gap-2 overflow-hidden rounded-lg border border-dashed border-primary/25 bg-gradient-to-b from-primary/[0.04] to-transparent text-center",
        compact ? "p-4" : "p-8",
        className,
      )}
    >
      <div className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Lock className="size-4" />
      </div>
      <div className="text-sm font-medium">{title ?? "Locked"}</div>
      <p className="max-w-sm text-xs text-muted-foreground">
        {tierLabel ? `Included with ${tierLabel} membership and above.` : "Not available on current plans."}
      </p>
      {requiredTier && (
        <Link
          href={`/upgrade?tier=${requiredTier}&feature=${encodeURIComponent(feature)}`}
          className={cn(buttonVariants({ size: "sm" }), "mt-1")}
        >
          Upgrade to {tierLabel}
        </Link>
      )}
    </div>
  );
}

/** Renders gated data, or a lock panel if the viewer lacks the entitlement. */
export function GatedView<T>({
  gated,
  title,
  userId,
  compact,
  className,
  children,
}: {
  gated: Gated<T>;
  title: string;
  userId?: string | null;
  compact?: boolean;
  className?: string;
  children: (data: T) => React.ReactNode;
}) {
  if (gated.locked) {
    return <LockedPanel feature={gated.feature} requiredTier={gated.requiredTier} title={title} userId={userId} compact={compact} className={className} />;
  }
  return <>{children(gated.data)}</>;
}
