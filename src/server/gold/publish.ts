import type { GoldLevel } from "./geometry";
import { planGoldUpdate, type GoldProposal } from "./pass";

export async function applyProposal(input: {
  ideas: GoldLevel[];
  live: GoldLevel[];
  propose: () => Promise<GoldProposal>;
  write: (plan: ReturnType<typeof planGoldUpdate>) => Promise<void>;
}): Promise<"kept" | "applied"> {
  let proposal: GoldProposal;
  try {
    proposal = await input.propose();
  } catch {
    return "kept";
  }
  const plan = planGoldUpdate({ proposal, ideas: input.ideas, live: input.live });
  await input.write(plan);
  return "applied";
}
