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

/** Prices stay as the model wrote them. Extra alternates are dropped. Unknown idea ids are not linked. */
export function parseBoardOutput(raw: unknown, knownIdeaIds: ReadonlySet<string>): { primary: BoardPick; alternates: BoardPick[] } {
  const parsed = outputSchema.parse(raw);
  return {
    primary: keep(parsed.primary, knownIdeaIds),
    alternates: parsed.alternates.slice(0, 4).map((pick) => keep(pick, knownIdeaIds)),
  };
}
