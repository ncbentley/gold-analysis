import type { EventType } from "@/server/db/schema";

export interface FieldValue<T> {
  value: T | null;
  confidence: number; // 0..1
}

export interface ParsedSignalFields {
  instrument: FieldValue<string>;
  direction: FieldValue<"LONG" | "SHORT">;
  entryType: FieldValue<"MARKET" | "LIMIT" | "ZONE">;
  entryMin: FieldValue<number>;
  entryMax: FieldValue<number>;
  stopLoss: FieldValue<number>;
  /** Priced targets, with null for a target the source left open. */
  targets: FieldValue<Array<number | null>>;
  signalType: FieldValue<string>;
  sourceConfidenceText: FieldValue<string>;
}

export interface ParsedInstruction {
  moveStop?: FieldValue<number | "ENTRY">;
  closeAll?: boolean;
  cancel?: boolean;
  targetHitIndex?: number | null;
  /** Stop and targets from a follow-up that does not state a new entry. */
  fillLevels?: { stopLoss: number | null; targets: Array<number | null> };
}

export interface ParseInput {
  rawText: string;
  payload: Record<string, unknown> | null;
  publishedAt: Date;
}

export interface ParseOutput {
  parserType: string;
  parserVersion: string;
  eventType: EventType;
  /** External id of the message this event refers to (replies, updates). */
  referencesExternalId: string | null;
  signal: ParsedSignalFields | null;
  instruction: ParsedInstruction | null;
  issues: string[];
  confidence: number;
}

export interface SignalParser {
  type: string;
  version: string;
  parse(input: ParseInput): ParseOutput;
}

export const REVIEW_THRESHOLD = 0.8;
