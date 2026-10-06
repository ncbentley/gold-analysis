import { PostHog } from "posthog-node";

export type AnalyticsCapture = {
  distinctId: string;
  event: string;
  properties: Record<string, unknown>;
};

export type AnalyticsSender = {
  capture(event: AnalyticsCapture): void;
  alias(userId: string, visitorId: string): void;
  setPerson(userId: string, setOnce: Record<string, string | null>, set: Record<string, string | null>): void;
};

let testSender: AnalyticsSender | null = null;
let realSender: AnalyticsSender | null = null;
let shutdownHooked = false;

export function installAnalyticsSender(sender: AnalyticsSender | null) {
  testSender = sender;
}

export function posthogHost() {
  return process.env.POSTHOG_HOST || "https://us.i.posthog.com";
}

function activeSender(): AnalyticsSender | null {
  if (!process.env.POSTHOG_API_KEY) return null;
  if (testSender) return testSender;
  return liveSender();
}

function liveSender(): AnalyticsSender {
  if (realSender) return realSender;
  const client = new PostHog(process.env.POSTHOG_API_KEY!, {
    host: posthogHost(),
    flushAt: 1,
    flushInterval: 10_000,
  });
  if (!shutdownHooked) {
    shutdownHooked = true;
    const onSignal = (signal: NodeJS.Signals) => {
      void client.shutdown(2_000).finally(() => process.kill(process.pid, signal));
    };
    process.once("SIGTERM", onSignal);
    process.once("SIGINT", onSignal);
  }
  realSender = {
    capture(event) {
      client.capture({ distinctId: event.distinctId, event: event.event, properties: event.properties });
    },
    alias(userId, visitorId) {
      // posthog-node 5.55: distinctId is the current id, alias is the id from before signup.
      client.alias({ distinctId: userId, alias: visitorId });
    },
    setPerson(userId, setOnce, set) {
      client.setPersonProperties({ distinctId: userId, properties: set, propertiesOnce: setOnce });
    },
  };
  return realSender;
}

export function capturePostHog(distinctId: string, event: string, properties: Record<string, unknown>) {
  activeSender()?.capture({ distinctId, event, properties });
}

export function aliasVisitor(userId: string, visitorId: string) {
  activeSender()?.alias(userId, visitorId);
}

export function setPerson(userId: string, setOnce: Record<string, string | null>, set: Record<string, string | null>) {
  activeSender()?.setPerson(userId, setOnce, set);
}
