/**
 * Gold prices are 3–5 digits, with optional decimals.
 * `(?<!\d\.)` keeps 1.4200 from being read as 4200. Dots that are not a decimal
 * point, as in "LIMIT...4365", still count. `(?<!\d)` keeps the match off the tail of a longer number.
 */
export const GOLD_NUMBER = String.raw`(?<!\d)(?<!\d\.)(\d{3,5}(?:[.,]\d{1,3})?)(?![\d.])`;
export const GOLD_NUMBER_G = /(?<!\d)(?<!\d\.)\d{3,5}(?:[.,]\d{1,3})?(?![\d.])/g;

const GOLD_WORD = /\b(?:XAU\s*\/?\s*USD|GOLD|XAU\s*\/?\s*EUR|XAU)\b/i;
const CHANNEL_PROMO = /\b(?:our|my|the)\s+xau\s*\/?\s*usd\s+channel\b/gi;
const OTHER_MARKET =
  /\b(?:EUR\/?USD|GBP\/?USD|USD\/?JPY|USD\/?CAD|EUR\/?CAD|GBP\/?CAD|AUD\/?CAD|NZD\/?CAD|CAD\/?CHF|CAD\/?JPY|EUR\/?AUD|GBP\/?AUD|AUD\/?JPY|AUD\/?NZD|AUD\/?USD|NZD\/?USD|USD\/?CHF|EUR\/?JPY|EUR\/?GBP|GBP\/?JPY|BTC(?:USD)?|NAS100|US30|XAG\/?USD|SILVER|Canadian\s+Dollar)\b/i;
/** 1.4200-style quotes. Gold prints as 4180 or 4180.50, not a one-to-three digit integer with four decimals. */
const FX_QUOTE = /(?<![\d.])\d{1,3}\.\d{4,5}(?![\d.])/;

/** True when the post itself names gold. A channel link or "our XAUUSD channel" footer does not count. */
export function callsGold(text: string) {
  const body = text.replace(/https?:\/\/\S+/gi, " ").replace(CHANNEL_PROMO, " ");
  return GOLD_WORD.test(body);
}

/** News or an FX/index post that never calls gold. */
export function isNonGoldMarketPost(text: string) {
  if (callsGold(text)) return false;
  return OTHER_MARKET.test(text) || FX_QUOTE.test(text);
}
