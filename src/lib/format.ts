export function initials(email: string) {
  const local = email.split("@")[0].replace(/[^a-z0-9]/gi, "");
  return (local.slice(0, 2) || "GI").toUpperCase();
}

export function fmtPrice(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function fmtEntry(min: number, max: number) {
  return min === max ? fmtPrice(min) : `${fmtPrice(min)} – ${fmtPrice(max)}`;
}

export function fmtR(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}R`;
}

export function fmtPct(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return `${Math.round(n * 100)}%`;
}

export function fmtMinutes(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  if (n < 60) return `${Math.round(n)}m`;
  const h = Math.floor(n / 60);
  const m = Math.round(n % 60);
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function fmtAge(iso: string | Date, now = Date.now()) {
  const t = typeof iso === "string" ? Date.parse(iso) : iso.getTime();
  return fmtMinutes(Math.max(0, (now - t) / 60_000));
}

export function fmtDateTime(iso: string | Date | null | undefined) {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

export function fmtDate(iso: string | Date | null | undefined) {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function fmtMoney(cents: number, currency = "usd") {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: 0 });
}
