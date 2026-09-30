import { Field, NativeSelect, toInputDateTime } from "@/components/admin-bits";
import { Input } from "@/components/ui/input";

const PRICE = "font-mono tabular-nums";

export interface SignalFieldDefaults {
  direction?: string | null;
  entryType?: string | null;
  entryMin?: number | null;
  entryMax?: number | null;
  stopLoss?: number | null;
  targets?: number[] | null;
  signalType?: string | null;
  sourceConfidenceText?: string | null;
  signalTime?: Date | string | null;
}

/** Shared field set for creating a signal from review and correcting an existing one. */
export function SignalFieldsForm({ d, idPrefix }: { d: SignalFieldDefaults; idPrefix: string }) {
  const id = (k: string) => `${idPrefix}-${k}`;
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-3.5 md:grid-cols-4">
      <Field label="Direction" htmlFor={id("direction")}>
        <NativeSelect id={id("direction")} name="direction" defaultValue={d.direction ?? ""} required>
          <option value="" disabled>
            Choose
          </option>
          <option value="LONG">Long</option>
          <option value="SHORT">Short</option>
        </NativeSelect>
      </Field>
      <Field label="Entry type" htmlFor={id("entryType")}>
        <NativeSelect id={id("entryType")} name="entryType" defaultValue={d.entryType ?? "ZONE"}>
          <option value="MARKET">Market</option>
          <option value="LIMIT">Limit</option>
          <option value="ZONE">Zone</option>
        </NativeSelect>
      </Field>
      <Field label="Entry (low)" htmlFor={id("entryMin")}>
        <Input id={id("entryMin")} name="entryMin" inputMode="decimal" defaultValue={d.entryMin ?? ""} required className={PRICE} />
      </Field>
      <Field label="Entry (high)" htmlFor={id("entryMax")} hint="Same as low for a single price">
        <Input id={id("entryMax")} name="entryMax" inputMode="decimal" defaultValue={d.entryMax ?? ""} className={PRICE} />
      </Field>
      <Field label="Stop loss" htmlFor={id("stopLoss")}>
        <Input id={id("stopLoss")} name="stopLoss" inputMode="decimal" defaultValue={d.stopLoss ?? ""} className={PRICE} />
      </Field>
      <Field label="Targets" htmlFor={id("targets")} hint="Comma separated" className="col-span-2 md:col-span-1">
        <Input id={id("targets")} name="targets" defaultValue={d.targets?.join(", ") ?? ""} className={PRICE} />
      </Field>
      <Field label="Signal type" htmlFor={id("signalType")}>
        <Input id={id("signalType")} name="signalType" defaultValue={d.signalType ?? ""} placeholder="scalp, swing…" />
      </Field>
      <Field label="Signal time (UTC)" htmlFor={id("signalTime")}>
        <Input id={id("signalTime")} name="signalTime" type="datetime-local" defaultValue={toInputDateTime(d.signalTime)} />
      </Field>
      <Field label="Source confidence text" htmlFor={id("sct")} className="col-span-2">
        <Input id={id("sct")} name="sourceConfidenceText" defaultValue={d.sourceConfidenceText ?? ""} />
      </Field>
    </div>
  );
}
