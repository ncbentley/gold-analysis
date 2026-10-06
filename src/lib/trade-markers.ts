import { fmtDateTime } from "@/lib/format";

const PREFIX: Record<string, string> = {
  ENTRY: "Filled",
  TARGET: "Target",
  STOP: "Stop",
  CLOSE: "Close filled",
  CANCEL: "Cancelled",
  EXPIRE: "Expired",
};

export function tradeMarkers(input: {
  calledAt: number;
  timeline: { t: number; type: string; note?: string; price?: number }[];
  goldClose?: { calledAt: number; exitTime: number | null } | null;
}): { t: number; label: string }[] {
  const stamp = (t: number, prefix: string) => ({ t, label: `${prefix} ${fmtDateTime(new Date(t))}` });
  const rows = [stamp(input.calledAt, "Called")];
  for (const event of input.timeline) {
    const prefix = event.type === "TARGET" && event.note ? event.note : (PREFIX[event.type] ?? event.type);
    if (event.type === "MOVE_STOP" || event.type === "AMBIGUOUS") continue;
    rows.push(stamp(event.t, prefix));
  }
  if (input.goldClose) {
    rows.push(stamp(input.goldClose.calledAt, "Close called"));
    if (input.goldClose.exitTime !== null) rows.push(stamp(input.goldClose.exitTime, "Close filled"));
  }
  return rows;
}
