/**
 * First-party campaign attribution.
 *
 * Captures UTM tags (`utm_*`), ad click ids (gclid, fbclid, and the rest of the
 * allowlist), and a short list of referral aliases. Anything else on the query
 * string is ignored so auth tokens and other secrets are never stored.
 *
 * The browser keeps first touch and last touch. First touch is the arrival
 * that created the visitor. Last touch moves only when a later visit carries
 * campaign parameters, and a repeat of the same campaign inside 30 minutes
 * does not count as a new touch.
 */

export const ATTR_COOKIE = "gsi_attr";
export const VID_COOKIE = "gsi_vid";
export const TOUCH_HEADER = "x-gsi-touch";
export const SESSION_MS = 30 * 60 * 1000;

const VALUE_MAX = 200;
const LANDING_MAX = 300;
const REFERRER_MAX = 300;
const MAX_PARAMS = 12;
const COOKIE_JSON_MAX = 1200;

const CLICK_IDS = [
  "gclid",
  "gbraid",
  "wbraid",
  "dclid",
  "gclsrc",
  "gad_source",
  "gad_campaignid",
  "fbclid",
  "msclkid",
  "ttclid",
  "twclid",
  "li_fat_id",
  "rdt_cid",
  "sccid",
  "irclickid",
  "mc_cid",
  "mc_eid",
  "yclid",
  "epik",
  "igshid",
] as const;

/** Query keys that are not `utm_*` or a click id, but still name a campaign. */
const ALIASES = ["ref", "referrer", "source", "campaign", "medium", "affiliate", "aff", "partner", "promo", "coupon", "via"] as const;

const CLICK_SOURCE: Record<string, string> = {
  gclid: "google",
  gbraid: "google",
  wbraid: "google",
  dclid: "google",
  gclsrc: "google",
  gad_source: "google",
  gad_campaignid: "google",
  fbclid: "facebook",
  igshid: "instagram",
  msclkid: "bing",
  ttclid: "tiktok",
  twclid: "x",
  li_fat_id: "linkedin",
  rdt_cid: "reddit",
  sccid: "snapchat",
  irclickid: "impact",
  mc_cid: "mailchimp",
  mc_eid: "mailchimp",
  yclid: "yandex",
  epik: "pinterest",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type Touch = {
  at: string;
  landing: string;
  referrer: string | null;
  params: Record<string, string>;
};

export type AttributionState = {
  visitorId: string;
  first: Touch;
  last: Touch;
};

export type Channel = { source: string; medium: string; campaign: string };

export function isAttributionKey(key: string) {
  const k = key.toLowerCase();
  if (k.length > 40) return false;
  if (/^utm_[a-z0-9_]{1,32}$/.test(k)) return true;
  return (CLICK_IDS as readonly string[]).includes(k) || (ALIASES as readonly string[]).includes(k);
}

export function extractParams(entries: Iterable<[string, string]>) {
  const params: Record<string, string> = {};
  const ranked: { key: string; value: string; rank: number }[] = [];
  const seen = new Set<string>();
  for (const [rawKey, rawValue] of entries) {
    const key = rawKey.toLowerCase();
    if (!isAttributionKey(key) || seen.has(key)) continue;
    const value = clean(rawValue, VALUE_MAX);
    if (!value) continue;
    seen.add(key);
    ranked.push({ key, value, rank: key.startsWith("utm_") ? 0 : key in CLICK_SOURCE ? 1 : 2 });
  }
  ranked.sort((a, b) => a.rank - b.rank);
  for (const row of ranked.slice(0, MAX_PARAMS)) params[row.key] = row.value;
  return params;
}

export function externalReferrer(referrer: string | null | undefined, requestHost: string): string | null {
  if (!referrer) return null;
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const own = requestHost.split(":")[0]?.toLowerCase();
  if (!own || url.hostname.toLowerCase() === own) return null;
  const path = url.pathname === "/" ? "" : url.pathname;
  return clean(`${url.origin}${path}`, REFERRER_MAX);
}

export function touchFromRequest(input: {
  pathname: string;
  searchParams: Iterable<[string, string]>;
  referrer: string | null;
  requestHost: string;
  now?: Date;
}): Touch {
  return {
    at: (input.now ?? new Date()).toISOString(),
    landing: clean(input.pathname || "/", LANDING_MAX) || "/",
    referrer: externalReferrer(input.referrer, input.requestHost),
    params: extractParams(input.searchParams),
  };
}

export function hasParams(touch: Touch) {
  return Object.keys(touch.params).length > 0;
}

export function paramsKey(params: Record<string, string>) {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

export function sessionBucket(at: string) {
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return "0";
  return String(Math.floor(ms / SESSION_MS));
}

/**
 * Returns the cookie state to store. `write` is true when the visitor is new
 * or the last touch changed, which is also when a touch row should be recorded.
 */
export function advanceAttribution(existing: AttributionState | null, visitorId: string | null, touch: Touch): { state: AttributionState; write: boolean } {
  const id = validVisitorId(visitorId) ?? validVisitorId(existing?.visitorId) ?? crypto.randomUUID();
  if (!existing) return { state: { visitorId: id, first: touch, last: touch }, write: true };

  const base = existing.visitorId === id ? existing : { ...existing, visitorId: id };
  if (!hasParams(touch)) return { state: base, write: base.visitorId !== existing.visitorId };

  const now = Date.parse(touch.at);
  const sameCampaign = paramsKey(base.last.params) === paramsKey(touch.params) && base.last.landing === touch.landing;
  const recent = !Number.isNaN(now) && now - Date.parse(base.last.at) < SESSION_MS;
  if (sameCampaign && recent && base.visitorId === existing.visitorId) return { state: base, write: false };
  return { state: { ...base, last: touch }, write: true };
}

export function channelOf(touch: Pick<Touch, "params" | "referrer">): Channel {
  const params = touch.params;
  const click = clickSource(params);
  const source = params.utm_source || params.source || params.ref || params.via || params.partner || click || referrerHost(touch.referrer) || "direct";
  const medium = params.utm_medium || params.medium || (click && !params.utm_source ? "cpc" : touch.referrer && !params.utm_source ? "referral" : params.utm_source ? "(not set)" : "none");
  const campaign = params.utm_campaign || params.campaign || "";
  return { source, medium, campaign };
}

export function encodeAttribution(state: AttributionState) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(fitCookie(state))));
}

export function decodeAttribution(raw: string | undefined | null): AttributionState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(base64UrlToUtf8(raw)) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as Partial<AttributionState>;
    const visitorId = validVisitorId(row.visitorId);
    const first = row.first ? sanitizeTouch(row.first) : null;
    const last = row.last ? sanitizeTouch(row.last) : null;
    if (!visitorId || !first || !last) return null;
    return { visitorId, first, last };
  } catch {
    return null;
  }
}

export function validVisitorId(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value.toLowerCase() : null;
}

function clickSource(params: Record<string, string>) {
  for (const key of Object.keys(CLICK_SOURCE)) {
    if (params[key]) return CLICK_SOURCE[key];
  }
  return "";
}

function referrerHost(referrer: string | null) {
  if (!referrer) return "";
  try {
    return new URL(referrer).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function sanitizeTouch(value: unknown): Touch | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<Touch>;
  if (typeof row.at !== "string" || Number.isNaN(Date.parse(row.at))) return null;
  if (typeof row.landing !== "string" || !row.landing.startsWith("/")) return null;
  const referrer = row.referrer == null ? null : typeof row.referrer === "string" ? clean(row.referrer, REFERRER_MAX) : null;
  const params: Record<string, string> = {};
  if (row.params && typeof row.params === "object" && !Array.isArray(row.params)) {
    for (const [key, param] of Object.entries(row.params)) {
      if (!isAttributionKey(key) || typeof param !== "string") continue;
      const cleaned = clean(param, VALUE_MAX);
      if (cleaned) params[key.toLowerCase()] = cleaned;
    }
  }
  return {
    at: new Date(row.at).toISOString(),
    landing: clean(row.landing, LANDING_MAX) || "/",
    referrer,
    params,
  };
}

function fitCookie(state: AttributionState): AttributionState {
  let current = state;
  for (const max of [VALUE_MAX, 120, 80, 40]) {
    if (JSON.stringify(current).length <= COOKIE_JSON_MAX) return current;
    current = { ...current, first: shrinkTouch(current.first, max), last: shrinkTouch(current.last, max) };
  }
  return current;
}

function shrinkTouch(touch: Touch, max: number): Touch {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(touch.params)) params[key] = value.slice(0, max);
  return { ...touch, referrer: touch.referrer?.slice(0, 120) ?? null, params };
}

function clean(value: string, max: number) {
  const trimmed = value.trim().replace(/[\u0000-\u001F\u007F]/g, "");
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

function bytesToBase64Url(bytes: Uint8Array) {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToUtf8(raw: string) {
  const pad = raw.length % 4 === 0 ? "" : "=".repeat(4 - (raw.length % 4));
  const bin = atob(raw.replaceAll("-", "+").replaceAll("_", "/") + pad);
  const bytes = Uint8Array.from(bin, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
