import type { MarketDataProvider, ProviderBar } from "./provider";

/**
 * Twelve Data adapter (https://twelvedata.com). Enabled when MARKET_DATA_PROVIDER=twelvedata
 * and TWELVEDATA_API_KEY is set. Not exercised in local development.
 */
export function createTwelveDataProvider(apiKey: string): MarketDataProvider {
  return {
    name: "twelvedata",
    async fetchMinuteBars(instrument, from, to) {
      const symbol = instrument === "XAUUSD" ? "XAU/USD" : instrument;
      const fmt = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");
      const url = new URL("https://api.twelvedata.com/time_series");
      url.search = new URLSearchParams({
        symbol,
        interval: "1min",
        start_date: fmt(from),
        end_date: fmt(to),
        timezone: "UTC",
        order: "ASC",
        outputsize: "5000",
        apikey: apiKey,
      }).toString();
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
      const body = (await res.json()) as { status?: string; message?: string; values?: Record<string, string>[] };
      if (body.status === "error") throw new Error(`Twelve Data: ${body.message}`);
      return (body.values ?? [])
        .map<ProviderBar>((v) => ({
          timestamp: new Date(`${v.datetime.replace(" ", "T")}Z`),
          open: Number(v.open),
          high: Number(v.high),
          low: Number(v.low),
          close: Number(v.close),
          volume: v.volume ? Number(v.volume) : null,
        }))
        .filter((b) => b.timestamp >= from && b.timestamp < to);
    },
  };
}
