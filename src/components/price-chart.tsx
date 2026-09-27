import { fmtDateTime, fmtPrice } from "@/lib/format";

type Level = { price: number; label: string; tone: "entry" | "stop" | "target" };
type Point = { t: number; h: number; l: number; c: number };

const TONE = { entry: "var(--primary)", stop: "var(--loss)", target: "var(--win)" };

/** Server-rendered SVG line chart with high/low band and trade levels. */
export function PriceChart({ points, levels, markers = [] }: { points: Point[]; levels: Level[]; markers?: { t: number; label: string }[] }) {
  if (points.length < 2) return <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">Not enough market data yet.</div>;
  const W = 800;
  const H = 240;
  const PAD = { l: 8, r: 64, t: 10, b: 22 };
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

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Price chart around the signal">
      <path d={band} fill="var(--foreground)" opacity="0.06" />
      {levels.map((l, i) => (
        <g key={i}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(l.price)} y2={y(l.price)} stroke={TONE[l.tone]} strokeDasharray={l.tone === "entry" ? "0" : "4 4"} strokeWidth="1" opacity="0.8" />
          <text x={W - PAD.r + 4} y={y(l.price) + 3} fontSize="10" fill={TONE[l.tone]} className="font-mono">
            {l.label} {fmtPrice(l.price)}
          </text>
        </g>
      ))}
      {markers.map((m, i) => (
        <g key={i}>
          <line x1={x(m.t)} x2={x(m.t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted-foreground)" strokeDasharray="2 3" opacity="0.6" />
          <text x={x(m.t) + 3} y={PAD.t + 10} fontSize="10" fill="var(--muted-foreground)">
            {m.label}
          </text>
        </g>
      ))}
      <path d={line} fill="none" stroke="var(--foreground)" strokeWidth="1.4" opacity="0.9" />
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
