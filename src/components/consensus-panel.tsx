import { Clock, TriangleAlert, Trophy, Users } from "lucide-react";
import { GatedView } from "@/components/locked";
import { cn } from "@/lib/utils";
import type { ConsensusGrade, ConsensusMapping, ConsensusTiming } from "@/server/consensus/rules";
import type { Gated } from "@/server/entitlements/access";

function fmtOffset(minutes: number) {
  if (minutes === 0) return "0 min";
  const sign = minutes > 0 ? "+" : "−";
  return `${sign}${Math.abs(minutes)} min`;
}

function SubPanel({ icon: IconCmp, title, children }: { icon: React.ComponentType<{ className?: string }>; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-black/25 p-3.5 ring-1 ring-glow/20">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#8db6ff]">
        <IconCmp className="size-3.5" />
        {title}
      </div>
      <div className="space-y-2 text-sm">{children}</div>
    </div>
  );
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
    <SubPanel icon={Clock} title="Timing">
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
    </SubPanel>
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
          <div className="space-y-3">
            <div className="panel-gold flex items-center gap-3.5 rounded-xl p-4 shadow-[0_0_24px_-10px_rgb(245_197_66/0.6)] ring-1 ring-primary/45">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/55">
                <Users className="size-5" />
              </span>
              <div className="min-w-0">
                <div data-testid="consensus-grade" className="gold-text font-heading text-2xl font-extrabold tracking-tight">
                  {data.label}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">{data.version}</div>
              </div>
            </div>
            {data.riskNote && (
              <p
                className={cn(
                  "flex gap-2 rounded-lg border p-3 text-sm",
                  data.risk === "high" ? "border-loss/35 bg-loss/5 text-loss" : "border-amber-400/30 bg-amber-400/5 text-amber-200",
                )}
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                {data.riskNote}
              </p>
            )}
            <GatedView gated={timing} title="Temporal alignment" userId={userId} compact>
              {(row) => (row ? <TimingBreakdown timing={row} /> : null)}
            </GatedView>
            <GatedView gated={mapping} title="How top historical performers line up" userId={userId} compact>
              {(row) =>
                row ? (
                  <SubPanel icon={Trophy} title="Top historical performers">
                    <p>{row.sentence}</p>
                    {row.oppositionSentence && <p className="text-muted-foreground">{row.oppositionSentence}</p>}
                  </SubPanel>
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
