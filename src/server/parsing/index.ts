import { jsonWebhookParser } from "./parsers/json-webhook";
import { textGenericParser } from "./parsers/text-generic";
import type { ParseInput, ParseOutput, SignalParser } from "./types";

const registry = new Map<string, SignalParser>([
  [textGenericParser.type, textGenericParser],
  [jsonWebhookParser.type, jsonWebhookParser],
]);

export const PARSER_TYPES = [...registry.keys()];

export function getParser(type: string): SignalParser {
  const parser = registry.get(type);
  if (!parser) throw new Error(`Unknown parser type: ${type}`);
  return parser;
}

export function parseEvent(parserType: string, input: ParseInput): ParseOutput {
  return getParser(parserType).parse(input);
}

export * from "./types";
