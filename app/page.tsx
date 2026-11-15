import { HeroActions } from "@/components/HeroActions";
import { PublicToolList } from "@/components/PublicToolList";

const STEPS = [
  { title: "List what you own", body: "Add a tool with its category, condition and a short description." },
  { title: "Request the dates", body: "Neighbours ask to borrow it for a date range; you approve or decline." },
  { title: "Get it back on time", body: "LendLoop sends the emails and an overdue reminder if a loan runs late." },
];

export default function Home() {
  return (
    <div className="space-y-14">
      <section className="rounded-3xl bg-gradient-to-br from-emerald-800 to-emerald-950 px-6 py-14 text-white sm:px-12">
        <p className="text-sm font-medium uppercase tracking-widest text-emerald-200">LendLoop</p>
        <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Borrow what you need. Lend what you don&apos;t.
        </h1>
        <p className="mt-4 max-w-xl text-emerald-100">
          A tool-lending board for your neighbourhood: drills, ladders, tents and stand mixers that would otherwise sit
          in a cupboard.
        </p>
        <div className="mt-8">
          <HeroActions />
        </div>
      </section>

      <section aria-labelledby="available-heading">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 id="available-heading" className="text-xl font-semibold tracking-tight">
              Available right now
            </h2>
            <p className="text-sm text-stone-600">Sign in to see details and request dates.</p>
          </div>
        </div>
        <PublicToolList />
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <div key={step.title} className="rounded-xl border border-stone-200 bg-white p-5">
            <p className="text-sm font-semibold text-emerald-700">Step {index + 1}</p>
            <h3 className="mt-1 font-semibold">{step.title}</h3>
            <p className="mt-1 text-sm text-stone-600">{step.body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
