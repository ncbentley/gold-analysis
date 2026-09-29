import { GatedView } from "@/components/locked";
import type { ConsensusGrade, ConsensusMapping, ConsensusTiming } from "@/server/consensus/rules";
import type { Gated } from "@/server/entitlements/access";

function fmtOffset(minutes: number) {
  if (minutes === 0) return "0 min";
  const sign = minutes > 0 ? "+" : "−";
  return `${sign}${Math.abs(minutes)} min`;
}

function TimingBreakdown({ timing }: { timing: ConsensusTiming }) {
  const aligned = timing.alignedSources === 1 ? "1 source" : `${timing.alignedSources} sources`;
  const opposed =
    timing.opposedSources === 0
      ? null
      : timing.opposedSources === 1
        ? "1 source published the other direction"
        : `${timing.opposedSources} sources published the other direction`;
  return (
    <div className="mt-4 space-y-2 text-sm">
      <p>
        {aligned} published this direction
        {opposed ? `, and ${opposed},` : ""} inside a {timing.windowMinutes}-minute window.
      </p>
      <p className="text-muted-foreground">
        The cluster spans {timing.clusterSpanMinutes} {timing.clusterSpanMinutes === 1 ? "minute" : "minutes"}.
        {timing.offsetsMinutes.length > 1
          ? ` Signals in the window landed at ${timing.offsetsMinutes.map(fmtOffset).join(", ")} relative to this one.`
          : " No other signal landed in the window."}
      </p>
    </div>
  );
}

export function ConsensusPanel({
  grade,
  timing,
  mapping,
  userId,
}: {
  grade: Gated<ConsensusGrade | null>;
  timing: Gated<ConsensusTiming | null>;
  mapping: Gated<ConsensusMapping | null>;
  userId?: string | null;
}) {
  return (
    <GatedView gated={grade} title="Consensus score" userId={userId}>
      {(data) =>
        data ? (
          <div className="space-y-4">
            <div>
              <div data-testid="consensus-grade" className="text-2xl font-semibold tracking-tight">
                {data.label}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">{data.version}</div>
            </div>
            {data.riskNote && (
              <p className={data.risk === "high" ? "text-sm text-loss" : "text-sm text-amber-200"}>{data.riskNote}</p>
            )}
            <GatedView gated={timing} title="Temporal alignment" userId={userId} compact>
              {(row) => (row ? <TimingBreakdown timing={row} /> : null)}
            </GatedView>
            <GatedView gated={mapping} title="How top historical performers line up" userId={userId} compact>
              {(row) =>
                row ? (
                  <div className="space-y-2 rounded-lg border bg-background/40 p-3 text-sm">
                    <p>{row.sentence}</p>
                    {row.oppositionSentence && <p className="text-muted-foreground">{row.oppositionSentence}</p>}
                  </div>
                ) : null
              }
            </GatedView>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Consensus is not available for this signal.</p>
        )
      }
    </GatedView>
  );
}
