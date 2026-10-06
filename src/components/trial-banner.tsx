import Link from "next/link";

export function TrialBanner({ endsAt }: { endsAt: Date }) {
  return (
    <div className="mb-6 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
      <p className="font-semibold">Upgrade this trial to Gold access.</p>
      <p className="mt-1 text-muted-foreground">
        Add a card for Silver or Gold and this trial stays on Gold until {endsAt.toUTCString()}. Each step up is a smaller, more curated set: every signal, then Silver ideas, then Gold ideas.
      </p>
      <Link href="/upgrade" className="mt-2 inline-block font-semibold text-primary">
        Choose Silver or Gold
      </Link>
    </div>
  );
}
