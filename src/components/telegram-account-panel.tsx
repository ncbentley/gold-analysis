import {
  telegramCancelLoginAction,
  telegramReconnectAction,
  telegramSendCodeAction,
  telegramSignOutAction,
  telegramVerifyAction,
} from "@/app/actions/admin";
import { Field } from "@/components/admin-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SecretKeySource } from "@/server/settings";

export function TelegramAccountPanel({
  status,
  keySource,
}: {
  status: {
    signedIn: boolean;
    connected: boolean;
    apiId: number | null;
    lastError: string | null;
    me: { name: string; username: string | null; phone: string | null } | null;
    pending: { phone: string; viaApp: boolean; needsPassword: boolean; passwordHint: string | null } | null;
  };
  keySource: SecretKeySource;
}) {
  return (
    <div className="space-y-4 text-sm">
      {status.lastError && <p className="rounded-lg border border-loss/40 bg-loss/10 px-3 py-2 text-loss">{status.lastError}</p>}

      {status.signedIn && status.me && (
        <>
          <div className="rounded-lg border border-glow/25 bg-black/20 px-3 py-2.5">
            <div className="font-semibold">{status.me.name}</div>
            <div className="text-xs text-muted-foreground">
              {[status.me.username && `@${status.me.username}`, status.me.phone, status.apiId && `API ID ${status.apiId}`].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {!status.connected && (
              <form action={telegramReconnectAction}>
                <Button type="submit" size="sm">
                  Reconnect
                </Button>
              </form>
            )}
            <form action={telegramSignOutAction}>
              <Button type="submit" size="sm" variant="outline">
                Sign out of Telegram
              </Button>
            </form>
          </div>
        </>
      )}

      {!status.signedIn && !status.pending && (
        <form action={telegramSendCodeAction} className="space-y-3">
          <ol className="list-decimal space-y-1.5 rounded-lg border border-glow/20 bg-black/15 py-2.5 pr-3 pl-7 text-xs text-muted-foreground marker:font-semibold marker:text-primary">
            <li>
              Sign in at{" "}
              <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                my.telegram.org/apps
              </a>{" "}
              with the account&apos;s phone number and create an application.
            </li>
            <li>Copy the App api_id and api_hash below.</li>
            <li>Telegram sends a login code to that account. Enter it in the next step.</li>
          </ol>
          <div className="grid grid-cols-3 gap-3">
            <Field label="API ID" htmlFor="tg-api-id">
              <Input id="tg-api-id" name="apiId" inputMode="numeric" required defaultValue={status.apiId ?? ""} autoComplete="off" className="font-mono" />
            </Field>
            <Field label="API hash" htmlFor="tg-api-hash" className="col-span-2">
              <Input id="tg-api-hash" name="apiHash" required autoComplete="off" spellCheck={false} placeholder="32 hex characters" className="font-mono" />
            </Field>
          </div>
          <Field label="Phone number" htmlFor="tg-phone" hint="International format, including the country code.">
            <Input id="tg-phone" name="phone" type="tel" required placeholder="+447700900123" autoComplete="off" className="font-mono" />
          </Field>
          <Button type="submit" className="w-full">
            Send login code
          </Button>
          {keySource === "missing" && <p className="text-xs text-loss">APP_SECRET is not set, so credentials can&apos;t be stored. Set it and restart.</p>}
        </form>
      )}

      {status.pending && (
        <div className="space-y-3">
          <p className="text-muted-foreground">
            {status.pending.needsPassword
              ? "This account uses two-step verification. Enter the Telegram cloud password."
              : status.pending.viaApp
                ? `A code was sent to the Telegram app signed in as ${status.pending.phone}.`
                : `A code was sent by SMS to ${status.pending.phone}.`}
          </p>
          <form action={telegramVerifyAction} className="space-y-3">
            {status.pending.needsPassword ? (
              <Field label="Two-step verification password" htmlFor="tg-password" hint={status.pending.passwordHint ? `Hint: ${status.pending.passwordHint}` : undefined}>
                <Input id="tg-password" name="password" type="password" required autoComplete="off" autoFocus />
              </Field>
            ) : (
              <Field label="Login code" htmlFor="tg-code">
                <Input id="tg-code" name="code" inputMode="numeric" required autoComplete="one-time-code" autoFocus placeholder="12345" className="font-mono tracking-widest" />
              </Field>
            )}
            <Button type="submit" className="w-full">
              {status.pending.needsPassword ? "Verify password" : "Sign in"}
            </Button>
          </form>
          <form action={telegramCancelLoginAction}>
            <Button type="submit" variant="ghost" size="sm" className="w-full">
              Cancel
            </Button>
          </form>
        </div>
      )}
    </div>
  );
}
