import Link from "next/link";
import { Activity, History, Hourglass } from "lucide-react";
import { SectionTitle } from "@/components/page-header";

export function BookSections(props: {
  available: React.ReactNode;
  active: React.ReactNode;
  history: React.ReactNode;
  historyCount: number;
}) {
  return (
    <>
      <section className="mt-8">
        <SectionTitle icon={Hourglass} title="Available" />
        {props.available}
      </section>
      <section className="mt-8">
        <SectionTitle icon={Activity} title="Active" />
        {props.active}
      </section>
      <section className="mt-8">
        <SectionTitle
          icon={History}
          title="History"
          action={
            props.historyCount > 5 ? (
              <Link href="/history" className="rounded text-sm font-medium text-[#8db6ff] outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
                View more
              </Link>
            ) : undefined
          }
        />
        {props.history}
      </section>
    </>
  );
}
