import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="mb-5 rounded-2xl bg-[#060d1f] px-5 py-7 ring-1 ring-primary/25 md:px-8 md:py-9">
        <div className="flex items-center gap-3.5">
          <Skeleton className="size-14 shrink-0 rounded-full bg-primary/10" />
          <Skeleton className="h-10 w-64 max-w-full bg-primary/10" />
        </div>
        <Skeleton className="mt-4 h-4 w-96 max-w-full" />
        <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <Skeleton className="size-10 rounded-full bg-primary/10" />
              <Skeleton className="h-3 w-24" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel flex items-center gap-3 rounded-xl p-3.5 ring-1 ring-glow/25">
            <Skeleton className="size-11 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3 w-20 max-w-full" />
              <Skeleton className="h-6 w-14" />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-8 mb-3 flex items-center gap-2">
        <Skeleton className="size-5 rounded-md bg-primary/10" />
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="panel space-y-1.5 rounded-2xl p-2 ring-1 ring-glow/25">
        <Skeleton className="mx-1 mb-2 h-4 w-2/3" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
