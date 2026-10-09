import Link from "next/link";

export function TrialBanner({ endsAt }: { endsAt: Date }) {
  return (
    <div className="mb-6 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
      <p className="font-semibold">Upgrade this trial to Gold access.</p>
      <p className="mt-1 text-muted-foreground">
        Basic keeps this book: every signal, one week back. Silver or Gold, added before {endsAt.toUTCString()}, stays on Gold until then. Each step up is a smaller set.
      </p>
      <Link href="/upgrade" className="mt-2 inline-block font-semibold text-primary">
        See plans
      </Link>
    </div>
  );
}
