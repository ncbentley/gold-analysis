import { z } from "zod";
import type { BoardPick } from "@/server/db/schema";

const pickSchema = z.object({
  direction: z.enum(["LONG", "SHORT"]),
  entryMin: z.number(),
  entryMax: z.number(),
  stopLoss: z.number().nullable(),
  targets: z.array(z.number()),
  writeup: z.string(),
  ideaIds: z.array(z.string()).default([]),
});

const outputSchema = z.object({
  primary: pickSchema,
  alternates: z.array(pickSchema).default([]),
  closeIds: z.array(z.string()).default([]),
});

function keep(pick: z.infer<typeof pickSchema>, knownIdeaIds: ReadonlySet<string>): BoardPick {
  return {
    direction: pick.direction,
    entryMin: pick.entryMin,
    entryMax: pick.entryMax,
    stopLoss: pick.stopLoss,
    targets: pick.targets,
    writeup: pick.writeup,
    ideaIds: pick.ideaIds.filter((id) => knownIdeaIds.has(id)),
  };
}

/** A pick with no stop or no target cannot finish. Fill those from the ideas it cites. */
export function finishBoardPick(
  pick: BoardPick,
  ideas: { id: string; stopLoss: number | null; targets: number[] }[],
): BoardPick | null {
  const cited = ideas.filter((idea) => pick.ideaIds.includes(idea.id));
  const stops = cited.map((idea) => idea.stopLoss).filter((price): price is number => price !== null);
  const withTargets = cited.filter((idea) => idea.targets.length > 0);
  const stopLoss = pick.stopLoss ?? (stops.length ? stops.reduce((sum, price) => sum + price, 0) / stops.length : null);
  let targets = pick.targets.filter((price) => Number.isFinite(price));
  if (!targets.length && withTargets.length) {
    const slots = Math.max(...withTargets.map((idea) => idea.targets.length));
    targets = Array.from({ length: slots }, (_, index) => {
      const prices = withTargets.map((idea) => idea.targets[index]).filter((price): price is number => price !== undefined);
      return prices.length ? prices.reduce((sum, price) => sum + price, 0) / prices.length : Number.NaN;
    }).filter((price) => Number.isFinite(price));
  }
  if (stopLoss === null || !targets.length) return null;
  return { ...pick, stopLoss, targets };
}

/** Prices stay as the model wrote them. Extra alternates are dropped. Unknown idea ids are not linked. */
export function parseBoardOutput(raw: unknown, knownIdeaIds: ReadonlySet<string>): { primary: BoardPick; alternates: BoardPick[]; closeIds: string[] } {
  const parsed = outputSchema.parse(raw);
  return {
    primary: keep(parsed.primary, knownIdeaIds),
    alternates: parsed.alternates.slice(0, 4).map((pick) => keep(pick, knownIdeaIds)),
    closeIds: parsed.closeIds,
  };
}
