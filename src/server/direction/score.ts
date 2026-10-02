import type { DirectionLean } from "@/server/db/schema";

export const LEAN_LABEL: Record<DirectionLean, string> = {
  bid: "Bid under gold",
  defensive: "Defensive",
  offered: "Risk premium fading",
};

const BID = /\b(strike|bomb(?:ing)?|carrier|troops|attacks?|hormuz|missiles?|invasion|reunification)\b/i;
const OFFER = /\b(talks|reopen(?:s|ed)?|ceasefire|de-escalat\w*|no plan to attack)\b/i;

export interface DirectionScoreInput {
  headlines: { text: string }[];
  /** Spot move over the prior hour, in USD per ounce. Null when no bars are stored. */
  change60m: number | null;
}

/** The stand-in analyst. A live model receives the same facts and the same lean rules. */
export function directionFromFacts(facts: DirectionScoreInput & { spot: number | null }) {
  const scored = scoreDirection(facts);
  const spot = facts.spot === null ? "Spot is unavailable." : `Spot is ${facts.spot.toFixed(2)}.`;
  const hour =
    facts.change60m === null ? "The hourly change is unavailable." : `The prior hour changed ${facts.change60m >= 0 ? "+" : ""}${facts.change60m.toFixed(2)}.`;
  return {
    lean: scored.lean,
    summary: `${scored.bid} of these headlines add to the risk premium and ${scored.offer} cut it. ${spot} ${hour} The read is ${LEAN_LABEL[scored.lean].toLowerCase()}.`,
    factsReferenced: ["headlines", "spot", "change60m"],
  };
}

/** Counts headlines, not keywords. One post can land on both sides. */
export function scoreDirection(input: DirectionScoreInput): { lean: DirectionLean; bid: number; offer: number } {
  let bid = 0;
  let offer = 0;
  for (const headline of input.headlines) {
    if (BID.test(headline.text)) bid += 1;
    if (OFFER.test(headline.text)) offer += 1;
  }
  const change = input.change60m ?? 0;
  if (bid > offer && change >= -5) return { lean: "bid", bid, offer };
  if (offer > bid && change <= 5) return { lean: "offered", bid, offer };
  return { lean: "defensive", bid, offer };
}
