import { fmtDateTime, fmtPrice } from "@/lib/format";

type Level = { price: number; label: string; tone: "entry" | "stop" | "target" };
type Point = { t: number; h: number; l: number; c: number };

const TONE = { entry: "var(--primary)", stop: "var(--loss)", target: "var(--win)" };
const GRID_LINES = 5;

/** Server-rendered SVG line chart with high/low band and trade levels. */
export function PriceChart({ points, levels, markers = [] }: { points: Point[]; levels: Level[]; markers?: { t: number; label: string }[] }) {
  if (points.length < 2)
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-glow/30 text-sm text-muted-foreground">Not enough market data yet.</div>
    );
  const W = 800;
  const H = 240;
  const PAD = { l: 8, r: 88, t: 10, b: 22 };
  const prices = [...points.flatMap((p) => [p.h, p.l]), ...levels.map((l) => l.price)];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0 || 1)) * (W - PAD.l - PAD.r);
  const y = (p: number) => PAD.t + (1 - (p - min) / span) * (H - PAD.t - PAD.b);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.c).toFixed(1)}`).join("");
  const band =
    points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.h).toFixed(1)}`).join("") +
    [...points].reverse().map((p) => `L${x(p.t).toFixed(1)},${y(p.l).toFixed(1)}`).join("") +
    "Z";
  const floor = H - PAD.b;
  const area = `${line}L${x(t1).toFixed(1)},${floor}L${x(t0).toFixed(1)},${floor}Z`;
  const last = points[points.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Price chart around the signal">
      <defs>
        <linearGradient id="price-chart-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {Array.from({ length: GRID_LINES }, (_, i) => PAD.t + (i / (GRID_LINES - 1)) * (floor - PAD.t)).map((gy) => (
        <line key={gy} x1={PAD.l} x2={W - PAD.r} y1={gy} y2={gy} stroke="var(--glow)" strokeOpacity="0.14" strokeDasharray="2 4" />
      ))}
      <path d={area} fill="url(#price-chart-area)" />
      <path d={band} fill="var(--primary)" opacity="0.08" />
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
      <path d={line} fill="none" stroke="var(--primary)" strokeWidth="1.6" strokeLinejoin="round" style={{ filter: "drop-shadow(0 0 4px rgb(245 197 66 / 0.55))" }} />
      <circle cx={x(last.t)} cy={y(last.c)} r="3" fill="var(--primary)" stroke="#040914" strokeWidth="1.5" />
      <text x={PAD.l} y={H - 6} fontSize="10" fill="var(--muted-foreground)">
        {fmtDateTime(new Date(t0))}
      </text>
      <text x={W - PAD.r} y={H - 6} fontSize="10" fill="var(--muted-foreground)" textAnchor="end">
        {fmtDateTime(new Date(t1))}
      </text>
    </svg>
  );
}

export function downsample<T extends { t: number; h: number; l: number; c: number }>(bars: T[], maxPoints = 320): Point[] {
  if (bars.length <= maxPoints) return bars;
  const step = Math.ceil(bars.length / maxPoints);
  const out: Point[] = [];
  for (let i = 0; i < bars.length; i += step) {
    const chunk = bars.slice(i, i + step);
    out.push({ t: chunk[0].t, h: Math.max(...chunk.map((b) => b.h)), l: Math.min(...chunk.map((b) => b.l)), c: chunk[chunk.length - 1].c });
  }
  return out;
}
