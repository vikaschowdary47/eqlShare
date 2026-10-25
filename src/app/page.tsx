import Link from "next/link";
import { getUser } from "@/lib/data";
import { ButtonLink, Logo, Money, ShareBar } from "@/components/ui";

const TYPES = [
  ["Shared Home", "Roommates, students, shared apartments"],
  ["Couple", "Manage expenses with your partner"],
  ["Family", "Household bills and family expenses"],
  ["Group", "Friends, trips, events, and shared costs"],
];

const FAQ = [
  ["Do I need to connect a bank account?", "No. Eqlshare never asks for bank details and never moves money. You pay each other the way you already do, and Eqlshare keeps the record everyone agrees on."],
  ["How does it read my bills?", "Upload the PDF statement. We find the provider, amount due, due date and billing period. If anything is missing or unclear, we ask you instead of guessing. Nothing is shared until a person confirms it."],
  ["What about the extra cent?", "$100.00 split three ways is $33.34, $33.33 and $33.33. The extra cent always goes to the same person, so the shares add up to the total every time."],
  ["Can I keep using Splitwise or Venmo?", "Yes. Eqlshare tracks who owes what. You can keep paying through whatever app you use now."],
  ["Is it free?", "Shared expenses, splitting and reminders are free during the beta. We haven't set pricing for automated bills yet."],
];

export default async function Landing() {
  const user = await getUser().catch(() => null);
  return (
    <div className="overflow-x-clip">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:bg-ink focus:text-white focus:px-4 focus:py-2 focus:rounded-lg">Skip to content</a>
      <header className="mx-auto max-w-[1200px] px-5 sm:px-8 h-20 flex items-center justify-between">
        <Link href="/" aria-label="Eqlshare home"><Logo /></Link>
        <nav aria-label="Primary" className="hidden md:flex gap-8 text-[15px] text-ink-2">
          <a href="#how" className="hover:text-ink">How it works</a>
          <a href="#spaces" className="hover:text-ink">Spaces</a>
          <a href="#trust" className="hover:text-ink">Trust</a>
          <a href="#faq" className="hover:text-ink">FAQ</a>
        </nav>
        <div className="flex items-center gap-2">
          {user ? <ButtonLink href="/home" size="sm">Open app</ButtonLink> : (
            <><Link href="/login" className="hidden sm:inline-flex h-9 items-center px-3.5 text-[15px] text-ink-2 hover:text-ink">Sign in</Link><ButtonLink href="/signup" size="sm">Get started</ButtonLink></>
          )}
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="mx-auto max-w-[1200px] px-5 sm:px-8 pt-10 sm:pt-16 pb-20 grid lg:grid-cols-[1.05fr_1fr] gap-14 items-center">
          <div className="rise">
            <p className="inline-flex items-center gap-2 h-8 px-3 rounded-full bg-surface ring-1 ring-line text-[13px] text-ink-2">
              <span className="size-1.5 rounded-full bg-brand" aria-hidden="true" />Closed beta for US households
            </p>
            <h1 className="mt-6 text-[clamp(44px,7vw,84px)] font-semibold tracking-[-0.055em] leading-[0.95]">
              Shared bills,<br /><span className="figure font-normal italic tracking-[-0.03em] text-brand-strong">organized</span> automatically.
            </h1>
            <p className="mt-6 text-[clamp(17px,1.6vw,20px)] text-ink-2 max-w-[34ch] leading-relaxed">
              Eqlshare reads the bill, splits it to the cent, and shows everyone what's due before it's late. No bank account needed.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="/signup" size="lg">Create your Space</ButtonLink>
              <ButtonLink href="#how" size="lg" variant="secondary">See how it works</ButtonLink>
            </div>
          </div>

          {/* Composition: statement → obligation */}
          <figure className="relative h-[480px] sm:h-[520px] rise-2" aria-label="Example: a ComEd statement for $184.40 becomes a $46.10 share for each of four roommates">
            <div className="absolute left-0 top-4 w-[64%] sm:w-[56%] rotate-[-4deg] rounded-[16px] bg-surface ring-1 ring-line shadow-[0_30px_60px_-30px_rgba(11,26,24,0.35)] p-5 font-mono text-[11px] text-ink-2">
              <div className="flex justify-between text-[12px] text-ink font-sans font-semibold"><span>ComEd</span><span className="text-muted font-normal">Statement</span></div>
              <div className="mt-4 space-y-1.5 opacity-70">
                <div className="h-1.5 w-4/5 rounded bg-line" /><div className="h-1.5 w-3/5 rounded bg-line" /><div className="h-1.5 w-2/3 rounded bg-line" />
              </div>
              <div className="mt-4 flex justify-between"><span>Billing period</span><span>Sep 18 to Oct 17</span></div>
              <div className="mt-2 flex justify-between items-center"><span>Total amount due</span><span className="relative px-1 text-ink font-semibold">$184.40<span className="absolute inset-x-0 -bottom-0.5 h-[2px] bg-brand grow-x" /></span></div>
              <div className="mt-2 flex justify-between items-center"><span>Due date</span><span className="relative px-1 text-ink font-semibold">Oct 29, 2026<span className="absolute inset-x-0 -bottom-0.5 h-[2px] bg-brand grow-x" style={{ animationDelay: "200ms" }} /></span></div>
              <div className="mt-4 space-y-1.5 opacity-70"><div className="h-1.5 w-full rounded bg-line" /><div className="h-1.5 w-1/2 rounded bg-line" /></div>
            </div>

            <div className="absolute right-0 bottom-0 w-[86%] sm:w-[72%] rounded-[24px] bg-night text-white p-6 sm:p-7 grain overflow-hidden shadow-[0_40px_80px_-30px_rgba(11,26,24,0.6)]">
              <div aria-hidden="true" className="absolute -right-20 -top-20 size-60 rounded-full bg-brand/30 blur-3xl" />
              <div className="flex items-center justify-between text-[13px] text-white/60"><span>Maple Apartment</span><span className="rounded-full ring-1 ring-white/25 px-2 py-0.5 text-[11px] uppercase tracking-wide">Example</span></div>
              <p className="mt-6 text-[13px] text-white/60">Your share due</p>
              <Money cents={4610} size="xl" className="block text-white" />
              <p className="mt-2 text-[14px] text-white/65">Electricity · ComEd · due Oct 29</p>
              <ShareBar tone="dark" className="mt-6" parts={[{ key: "a", cents: 1, state: "own" }, { key: "b", cents: 1, state: "paid" }, { key: "c", cents: 1, state: "pending" }, { key: "d", cents: 1, state: "open" }]} />
              <div className="mt-3 grid grid-cols-4 text-[11px] text-white/55"><span>Priya<br />paid upfront</span><span>Marcus<br />confirmed</span><span>Jordan<br />reported</span><span>You<br />$46.10</span></div>
            </div>

            <svg className="absolute left-[44%] top-[40%] hidden sm:block" width="90" height="70" viewBox="0 0 90 70" aria-hidden="true">
              <path d="M4 6 C 40 6, 60 20, 70 56" fill="none" stroke="var(--brand)" strokeWidth="1.6" strokeDasharray="4 5" />
              <path d="M62 50 L70 58 L76 48" fill="none" stroke="var(--brand)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </figure>
        </section>

        {/* How it works: a real sequence */}
        <section id="how" className="border-t border-line bg-surface">
          <div className="mx-auto max-w-[1200px] px-5 sm:px-8 py-24 grid lg:grid-cols-[1fr_1.4fr] gap-14">
            <div>
              <h2 className="text-[clamp(32px,4.5vw,54px)] font-semibold tracking-[-0.045em] leading-[1]">From inbox to <span className="figure italic font-normal text-brand-strong">everyone knows</span>.</h2>
              <p className="mt-5 text-[17px] text-ink-2 max-w-[38ch]">The bill usually lands in one person's email. Eqlshare makes it the whole household's information.</p>
            </div>
            <ol className="relative border-l border-line-strong ml-3 space-y-12">
              {[
                ["The bill arrives", "Upload the PDF, or forward the email to your Space's private address. We find the provider, amount due, due date and billing period."],
                ["You check it", "Anything we couldn't read clearly is flagged, and missing details stay empty. A person confirms every bill before anyone sees a charge."],
                ["Everyone sees their share", "The bill is split to the cent. Each person sees what they owe and when it's due. Payments are marked reported, then confirmed by whoever paid the bill."],
              ].map(([t, d], i) => (
                <li key={t} className="pl-10 relative">
                  <span className="absolute -left-[15px] top-0 grid place-items-center size-[30px] rounded-full bg-ink text-white text-[13px] num font-semibold">{i + 1}</span>
                  <h3 className="text-[22px] font-semibold tracking-[-0.02em]">{t}</h3>
                  <p className="mt-2 text-[16px] text-ink-2 max-w-[52ch]">{d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Spaces */}
        <section id="spaces" className="mx-auto max-w-[1200px] px-5 sm:px-8 py-24">
          <h2 className="text-[clamp(32px,4.5vw,54px)] font-semibold tracking-[-0.045em] leading-[1] max-w-[18ch]">One app for everything you share.</h2>
          <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 border-t border-ink">
            {TYPES.map(([t, d], i) => (
              <div key={t} className={`pt-6 pb-8 pr-6 ${i > 0 ? "lg:pl-6 lg:border-l border-line" : ""}`}>
                <p className="text-[20px] font-semibold tracking-[-0.02em]">{t}</p>
                <p className="mt-2 text-[15px] text-muted">{d}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Trust */}
        <section id="trust" className="mx-3 sm:mx-6 rounded-[32px] bg-night text-white grain overflow-hidden relative">
          <div className="mx-auto max-w-[1200px] px-5 sm:px-8 py-24 grid lg:grid-cols-2 gap-14">
            <h2 className="text-[clamp(32px,4.5vw,54px)] font-semibold tracking-[-0.045em] leading-[1]">We keep the record.<br /><span className="figure italic font-normal text-brand">You keep your money.</span></h2>
            <ul className="divide-y divide-white/10 text-[16px]">
              {[
                "No bank logins, card numbers or money transfers.",
                "Only members of a Space can see its bills. Access is checked on our servers for every request.",
                "We never say a payment is verified unless the provider confirms it. Reported and confirmed are always separate.",
                "Statements are stored privately. Export your records whenever you like.",
              ].map((x) => (
                <li key={x} className="py-4 flex gap-4"><span className="text-brand mt-0.5" aria-hidden="true">=</span><span className="text-white/85">{x}</span></li>
              ))}
            </ul>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="mx-auto max-w-[900px] px-5 sm:px-8 py-24">
          <h2 className="text-[clamp(32px,4.5vw,54px)] font-semibold tracking-[-0.045em] leading-[1]">Questions</h2>
          <div className="mt-10 border-t border-line">
            {FAQ.map(([q, a]) => (
              <details key={q} className="group border-b border-line">
                <summary className="flex items-center justify-between gap-6 py-5 cursor-pointer list-none text-[18px] font-medium tracking-[-0.01em] [&::-webkit-details-marker]:hidden">
                  {q}
                  <span aria-hidden="true" className="grid place-items-center size-8 rounded-full ring-1 ring-line-strong transition-transform duration-300 group-open:rotate-45 shrink-0">+</span>
                </summary>
                <p className="pb-6 -mt-1 text-[16px] text-ink-2 max-w-[62ch]">{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-[1200px] px-5 sm:px-8 pb-24">
          <div className="rounded-[28px] bg-surface ring-1 ring-line p-8 sm:p-14 flex flex-col md:flex-row md:items-end justify-between gap-8">
            <h2 className="text-[clamp(30px,4vw,48px)] font-semibold tracking-[-0.045em] leading-[1.02] max-w-[16ch]">Set up your Space in two minutes.</h2>
            <ButtonLink href="/signup" size="lg">Get started free</ButtonLink>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-[1200px] px-5 sm:px-8 py-10 flex flex-wrap items-center justify-between gap-4 text-[14px] text-muted">
          <Logo className="!text-[16px]" />
          <nav aria-label="Legal" className="flex gap-6"><Link href="/privacy" className="hover:text-ink">Privacy</Link><Link href="/terms" className="hover:text-ink">Terms</Link><a href="mailto:support@eqlshare.com" className="hover:text-ink">Support</a></nav>
          <p>© 2026 Eqlshare</p>
        </div>
      </footer>
    </div>
  );
}
