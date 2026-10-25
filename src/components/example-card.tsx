import { Money, ShareBar } from "./ui";

/** Illustrative only. Clearly labeled so it is never mistaken for real account data. */
export function ExampleObligationCard() {
  const parts = [
    { key: "a", cents: 4610, state: "own" as const },
    { key: "b", cents: 4610, state: "paid" as const },
    { key: "c", cents: 4610, state: "pending" as const },
    { key: "d", cents: 4610, state: "open" as const },
  ];
  return (
    <figure className="rounded-[22px] bg-night-2/80 ring-1 ring-white/10 p-6 backdrop-blur-sm">
      <div className="flex items-center justify-between text-[13px] text-white/60">
        <span>Electricity · ComEd</span>
        <span className="rounded-full ring-1 ring-white/25 px-2 py-0.5 text-[11px] tracking-wide uppercase">Example</span>
      </div>
      <p className="mt-6 text-[13px] text-white/60">Your share</p>
      <Money cents={4610} size="lg" className="text-white" />
      <p className="mt-1 text-[14px] text-white/60">of $184.40 · due Oct 29</p>
      <ShareBar tone="dark" parts={parts} className="mt-6" />
      <ul className="mt-4 grid grid-cols-2 gap-y-2 text-[13px] text-white/75">
        <li>Priya · paid upfront</li><li className="text-right">Marcus · confirmed</li>
        <li>Jordan · reported</li><li className="text-right">You · $46.10 due</li>
      </ul>
      <figcaption className="sr-only">Example: a $184.40 electricity bill split four ways at $46.10 each.</figcaption>
    </figure>
  );
}
