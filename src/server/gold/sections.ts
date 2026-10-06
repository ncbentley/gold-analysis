import type { Viewer } from "@/server/entitlements/service";
import { listIdeasForViewer, type ListedIdea } from "@/server/ideas/service";
import { goldSection } from "./close";
import { listGoldEntries } from "./store";

export interface GoldBookCard extends ListedIdea {
  close: boolean;
  section: "available" | "active" | "history";
}

/** Gold rows joined to the Silver idea they came from. Section follows the close hold, then the idea phase. */
export async function goldBookCards(viewer: Viewer, spot: number | null, now = Date.now()): Promise<GoldBookCard[]> {
  const [ideas, rows] = await Promise.all([listIdeasForViewer(viewer, spot), listGoldEntries()]);
  const byId = new Map(ideas.map((idea) => [idea.id, idea]));
  const cards: GoldBookCard[] = [];
  for (const row of rows) {
    const idea = byId.get(row.ideaId);
    if (!idea) continue;
    const section = goldSection(
      {
        sectionAtCall: row.sectionAtCall,
        closeCalledAt: row.closeCalledAt ? row.closeCalledAt.getTime() : null,
        phase: idea.phase,
      },
      now,
    );
    cards.push({
      ...idea,
      phase: section === "active" ? "playing-out" : section,
      close: row.closeCalledAt !== null && section !== "history",
      section,
    });
  }
  return cards;
}
