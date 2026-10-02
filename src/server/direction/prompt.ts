import { z } from "zod";
import { DIRECTION_LEANS } from "@/server/db/schema";

export const marketDirectionOutputSchema = z.object({
  lean: z.enum(DIRECTION_LEANS),
  summary: z.string().min(1),
  factsReferenced: z.array(z.string()),
});

export const MARKET_DIRECTION_EXAMPLE = JSON.stringify({
  lean: "defensive",
  summary: "Two sentences from the facts. The first names the headline mix. The second names spot and the hourly change when those facts exist.",
  factsReferenced: ["headlines", "spot", "change60m"],
});

export const MARKET_DIRECTION_SYSTEM = `You write the market-direction read for a gold information product.
Rules:
- Use ONLY the structured facts supplied in the user message. Never invent prices, headlines, or events.
- lean is bid when the headlines support a higher gold price, offered when they cut the risk premium, and defensive when the two sides are close or price is fighting the headlines.
- summary is at most two sentences. Describe the mix. Do not tell the reader to buy, sell, or size a position.
- If spot or change60m is null, say the price fact is unavailable.
- List every fact key you relied on in "factsReferenced".
Respond with JSON matching this shape, not a JSON schema:
${MARKET_DIRECTION_EXAMPLE}`;
