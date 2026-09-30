"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import type { FormState } from "@/app/actions/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Field = { name: string; label: string; type?: string; autoComplete?: string; placeholder?: string };

export function AuthForm({
  action,
  fields,
  submitLabel,
  hidden = {},
  terms,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  fields: Field[];
  submitLabel: string;
  hidden?: Record<string, string>;
  terms?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  return (
    <form action={formAction} className="space-y-4">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {fields.map((f) => (
        <div key={f.name} className="space-y-1.5">
          <Label htmlFor={f.name} className="text-foreground/90">{f.label}</Label>
          <Input
            id={f.name}
            name={f.name}
            type={f.type ?? "text"}
            autoComplete={f.autoComplete}
            placeholder={f.placeholder}
            required
            className="h-10 border-glow/30 bg-[#060e20]/90 hover:border-glow/50"
          />
        </div>
      ))}
      {terms && (
        <label className="flex items-start gap-2.5 rounded-lg bg-black/20 p-3 text-xs leading-relaxed text-muted-foreground ring-1 ring-glow/15">
          <input type="checkbox" name="terms" className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" required />
          <span>
            I agree to the <a href="/terms" className="font-medium text-primary underline-offset-2 hover:underline">terms</a> and understand this is general market information, not personal financial advice.
          </span>
        </label>
      )}
      {state?.error && (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {state?.ok && (
        <Alert className="border-win/30 bg-win/5">
          <AlertDescription>{state.ok}</AlertDescription>
        </Alert>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending && <Loader2 className="animate-spin motion-reduce:animate-none" />}
        {submitLabel}
      </Button>
    </form>
  );
}
