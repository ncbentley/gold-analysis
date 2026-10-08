import { fmtDateTime, fmtPrice } from "@/lib/format";

type Level = { price: number; label: string; tone: "entry" | "stop" | "target" };
type Point = { t: number; o: number; h: number; l: number; c: number };

const TONE = { entry: "var(--primary)", stop: "var(--loss)", target: "var(--win)" };
const GRID_LINES = 5;

/** Server-rendered candlestick chart. One bar is a chart. Zero bars is a missing series. */
export function PriceChart({
  points,
  levels,
  markers = [],
  notice = null,
}: {
  points: Point[];
  levels: Level[];
  markers?: { t: number; label: string }[];
  notice?: string | null;
}) {
  if (!points.length) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-loss/40 bg-loss/5 px-6 text-center text-sm text-loss">
        {notice ?? "No XAU/USD bars are stored for this call. Price cannot be replayed."}
      </div>
    );
  }
  const W = 800;
  const H = 240;
  const PAD = { l: 8, r: 88, t: 10, b: 22 };
  const prices = [...points.flatMap((p) => [p.h, p.l]), ...levels.map((l) => l.price)];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const plotW = W - PAD.l - PAD.r;
  const slot = plotW / points.length;
  const bodyW = Math.max(1.4, Math.min(8, slot * 0.62));
  const spanT = t1 - t0 || slot;
  const x = (t: number) => (points.length === 1 ? PAD.l + plotW / 2 : PAD.l + bodyW / 2 + ((t - t0) / spanT) * (plotW - bodyW));
  const y = (p: number) => PAD.t + (1 - (p - min) / span) * (H - PAD.t - PAD.b);
  const floor = H - PAD.b;
  return (
    <div>
      {notice ? <p className="px-2 pt-1.5 text-xs leading-relaxed text-loss">{notice}</p> : null}
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Price candles around the signal">
        {Array.from({ length: GRID_LINES }, (_, i) => PAD.t + (i / (GRID_LINES - 1)) * (floor - PAD.t)).map((gy) => (
          <line key={gy} x1={PAD.l} x2={W - PAD.r} y1={gy} y2={gy} stroke="var(--glow)" strokeOpacity="0.14" strokeDasharray="2 4" />
        ))}
        {levels.map((l, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(l.price)} y2={y(l.price)} stroke={TONE[l.tone]} strokeDasharray={l.tone === "entry" ? "0" : "5 4"} strokeWidth="1.1" opacity="0.85" />
            <rect x={W - PAD.r + 3} y={y(l.price) - 7.5} width={PAD.r - 5} height="15" rx="3" fill={TONE[l.tone]} fillOpacity="0.14" stroke={TONE[l.tone]} strokeOpacity="0.6" />
            <text x={W - PAD.r + 7} y={y(l.price) + 3.5} fontSize="10" fontWeight="600" fill={TONE[l.tone]} className="font-mono">
              {l.label} {fmtPrice(l.price)}
            </text>
          </g>
        ))}
        {markers.map((m, i) => {
          const lift = markers.slice(0, i).filter((earlier) => Math.abs(x(earlier.t) - x(m.t)) <= 8).length * 12;
          return (
            <g key={i}>
              <line x1={x(m.t)} x2={x(m.t)} y1={PAD.t} y2={floor} stroke="#8db6ff" strokeDasharray="2 3" opacity="0.55" />
              <text x={x(m.t) + 4} y={PAD.t + 10 + lift} fontSize="10" fontWeight="600" fill="#8db6ff">
                {m.label}
              </text>
            </g>
          );
        })}
        {points.map((p) => {
          const up = p.c >= p.o;
          const color = p.c === p.o ? "#8db6ff" : up ? "var(--win)" : "var(--loss)";
          const cx = x(p.t);
          const yHigh = y(p.h);
          const yLow = y(p.l);
          const yOpen = y(p.o);
          const yClose = y(p.c);
          const top = Math.min(yOpen, yClose);
          const height = Math.max(1, Math.abs(yClose - yOpen));
          return (
            <g key={p.t}>
              <line x1={cx} x2={cx} y1={yHigh} y2={yLow} stroke={color} strokeWidth="1" />
              <rect x={cx - bodyW / 2} y={top} width={bodyW} height={height} fill={color} />
            </g>
          );
        })}
        <text x={PAD.l} y={H - 6} fontSize="10" fill="var(--muted-foreground)">
          {fmtDateTime(new Date(t0))}
        </text>
        <text x={W - PAD.r} y={H - 6} fontSize="10" fill="var(--muted-foreground)" textAnchor="end">
          {fmtDateTime(new Date(t1))}
        </text>
      </svg>
    </div>
  );
}

export function downsample<T extends { t: number; o: number; h: number; l: number; c: number }>(bars: T[], maxPoints = 320): Point[] {
  if (bars.length <= maxPoints) return bars;
  const step = Math.ceil(bars.length / maxPoints);
  const out: Point[] = [];
  for (let i = 0; i < bars.length; i += step) {
    const chunk = bars.slice(i, i + step);
    out.push({
      t: chunk[0].t,
      o: chunk[0].o,
      h: Math.max(...chunk.map((b) => b.h)),
      l: Math.min(...chunk.map((b) => b.l)),
      c: chunk[chunk.length - 1].c,
    });
  }
  return out;
}
