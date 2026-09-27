import { accessPayload, json, withViewer } from "@/server/api";

export async function GET() {
  return withViewer(async (viewer) =>
    json({
      data: {
        ...accessPayload(viewer),
        subscription: viewer.subscription
          ? {
              tier: viewer.subscription.tier,
              period: viewer.subscription.period,
              status: viewer.subscription.status,
              currentPeriodEnd: viewer.subscription.currentPeriodEnd.toISOString(),
              cancelAtPeriodEnd: viewer.subscription.cancelAtPeriodEnd,
            }
          : null,
      },
    }),
  );
}
