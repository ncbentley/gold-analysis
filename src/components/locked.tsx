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
        "relative isolate flex flex-col items-center justify-center overflow-hidden rounded-xl border border-dashed border-primary/40 bg-[radial-gradient(ellipse_at_top,rgb(245_197_66/0.09),transparent_65%),linear-gradient(180deg,rgb(47_123_255/0.06),rgb(6_12_26/0.4))] text-center shadow-[inset_0_0_0_1px_rgb(47_123_255/0.12)]",
        compact ? "gap-1.5 p-4" : "gap-2.5 p-8",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center justify-center rounded-xl bg-primary/10 text-primary shadow-[0_0_18px_-4px_rgb(245_197_66/0.6)] ring-1 ring-primary/60",
          compact ? "size-9" : "size-12",
        )}
      >
        <Lock className={compact ? "size-4" : "size-5"} />
      </div>
      <div className={cn("font-heading font-bold tracking-tight", compact ? "text-sm" : "text-base")}>{title ?? "Locked"}</div>
      <p className="max-w-sm text-xs text-muted-foreground">
        {tierLabel ? `Included with ${tierLabel} membership and above.` : "Not available on current plans."}
      </p>
      {requiredTier && (
        <Link
          href={`/upgrade?tier=${requiredTier}&feature=${encodeURIComponent(feature)}`}
          className={cn(buttonVariants({ size: compact ? "sm" : "default" }), "mt-1")}
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
