"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createInviteAction, createSpaceAction } from "@/lib/actions";
import { SPACE_PRESETS, SPACE_TYPES, type SpaceType } from "@/lib/domain/spaces";
import { Button, ButtonLink, Field, Input, Logo, Notice, cx } from "@/components/ui";
import { CopyField } from "@/components/copy-field";

type Step = "type" | "join" | "name" | "invite" | "first";

const TYPE_ART: Record<SpaceType, React.ReactNode> = {
  shared_home: <><path d="M4 11.5 12 5l8 6.5" /><path d="M6.5 10v9h11v-9" /><path d="M12 19v-5" /></>,
  couple: <><circle cx="9" cy="12" r="5" /><circle cx="15" cy="12" r="5" /></>,
  family: <><circle cx="7" cy="8" r="2.4" /><circle cx="17" cy="8" r="2.4" /><circle cx="12" cy="13" r="2" /><path d="M3.5 19c.5-3 2-4.5 3.5-4.5S10 16 10.4 19M13.6 19c.4-3 2-4.5 3.4-4.5s3 1.5 3.5 4.5" /></>,
  group: <><circle cx="6" cy="9" r="2.2" /><circle cx="12" cy="7" r="2.2" /><circle cx="18" cy="9" r="2.2" /><path d="M3 18c.6-3 1.8-4.5 3-4.5M21 18c-.6-3-1.8-4.5-3-4.5M8 18.5c.5-3.5 2-5 4-5s3.5 1.5 4 5" /></>,
};

export function Onboarding({ firstName, hasSpaces }: { firstName: string; hasSpaces: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("type");
  const [type, setType] = useState<SpaceType>("shared_home");
  const [name, setName] = useState("");
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [invite, setInvite] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinLink, setJoinLink] = useState("");
  const [pending, start] = useTransition();
  const preset = SPACE_PRESETS[type];
  const order: Step[] = ["type", "name", "invite", "first"];
  const idx = Math.max(0, order.indexOf(step));

  function createSpace(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await createSpaceAction({ name, type });
      if (!r.ok) return setError(r.error);
      setSpaceId(r.data.id);
      const inv = await createInviteAction(r.data.id);
      if (inv.ok) setInvite(inv.data.url);
      setStep("invite");
    });
  }

  function join(e: React.FormEvent) {
    e.preventDefault();
    const token = joinLink.trim().split("/join/").pop()?.split(/[?#]/)[0] ?? "";
    if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) return setError("Paste the full invite link you were sent.");
    router.push(`/join/${token}`);
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="flex items-center justify-between px-5 sm:px-10 h-16">
        <Logo />
        {hasSpaces ? <Link href="/home" className="text-[14px] text-ink-2 hover:text-ink">Cancel</Link> : <span />}
      </header>
      {step !== "join" && (
        <div className="px-5 sm:px-10" aria-hidden="true">
          <div className="mx-auto max-w-[560px] flex gap-1.5">
            {order.map((s, i) => <span key={s} className={cx("h-1 flex-1 rounded-full transition-colors duration-500", i <= idx ? "bg-ink" : "bg-line")} />)}
          </div>
        </div>
      )}

      <main className="flex-1 px-5 sm:px-10 py-10 sm:py-16">
        <div className="mx-auto max-w-[560px]">
          {error && <div className="mb-6"><Notice tone="error" title={error} /></div>}

          {step === "type" && (
            <section className="rise" aria-labelledby="t">
              <p className="text-[12px] font-medium tracking-[0.16em] text-teal-ink">EQLSHARE · GET STARTED</p>
              <h1 id="t" className="mt-3 text-[clamp(32px,6vw,44px)] font-semibold tracking-[-0.04em] leading-[1.05]">What are you sharing?</h1>
              <p className="mt-3 text-[17px] text-muted">Choose a Space type. You can customize it later.</p>
              <div role="radiogroup" aria-labelledby="t" className="mt-8 grid gap-3">
                {SPACE_TYPES.map((t) => {
                  const on = t === type;
                  return (
                    <button key={t} type="button" role="radio" aria-checked={on} onClick={() => setType(t)}
                      onKeyDown={(e) => {
                        const i = SPACE_TYPES.indexOf(t);
                        if (e.key === "ArrowDown" || e.key === "ArrowRight") { e.preventDefault(); setType(SPACE_TYPES[(i + 1) % 4]); (e.currentTarget.nextElementSibling as HTMLElement | null)?.focus(); }
                        if (e.key === "ArrowUp" || e.key === "ArrowLeft") { e.preventDefault(); setType(SPACE_TYPES[(i + 3) % 4]); (e.currentTarget.previousElementSibling as HTMLElement | null)?.focus(); }
                      }}
                      tabIndex={on ? 0 : -1}
                      className={cx(
                        "group flex items-center gap-4 text-left rounded-[18px] p-4 sm:p-5 bg-surface transition-all duration-300 ease-out-soft",
                        on ? "ring-2 ring-ink shadow-[0_12px_30px_-18px_rgba(11,26,24,0.45)]" : "ring-1 ring-line hover:ring-line-strong hover:-translate-y-0.5",
                      )}>
                      <span className={cx("grid place-items-center size-12 rounded-[14px] transition-colors", on ? "bg-ink text-white" : "bg-sunken text-ink-2")}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{TYPE_ART[t]}</svg>
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[17px] font-semibold tracking-[-0.01em]">{SPACE_PRESETS[t].label}</span>
                        <span className="block text-[15px] text-muted">{SPACE_PRESETS[t].blurb}</span>
                      </span>
                      <span className={cx("size-5 rounded-full ring-2 grid place-items-center transition", on ? "ring-ink bg-ink" : "ring-line-strong")} aria-hidden="true">
                        {on && <span className="size-2 rounded-full bg-white" />}
                      </span>
                    </button>
                  );
                })}
              </div>
              <Button size="lg" full className="mt-8" onClick={() => { setError(null); setStep("name"); }}>Continue with {preset.label}</Button>
              <Link href="/import" className="mt-4 flex items-center gap-3 rounded-[16px] bg-surface ring-1 ring-line p-4 hover:ring-ink/40 transition">
                <span className="flex-1"><span className="block text-[15px] font-semibold">Coming from Splitwise?</span><span className="block text-[14px] text-muted">Import your groups from a few screenshots</span></span>
                <span aria-hidden="true">→</span>
              </Link>
              <p className="mt-6 text-center text-[15px] text-ink-2">
                Have an invite? <button type="button" onClick={() => { setError(null); setStep("join"); }} className="font-medium text-teal-ink underline underline-offset-4 decoration-teal/30 hover:decoration-teal">Join an existing Space</button>
              </p>
            </section>
          )}

          {step === "join" && (
            <form onSubmit={join} className="rise">
              <h1 className="text-[clamp(30px,6vw,40px)] font-semibold tracking-[-0.04em] leading-tight">Join an existing Space</h1>
              <p className="mt-3 text-[17px] text-muted">Paste the invite link someone sent you. You'll see the Space name before you join.</p>
              <div className="mt-8"><Field label="Invite link" htmlFor="link"><Input id="link" value={joinLink} onChange={(e) => setJoinLink(e.target.value)} placeholder="https://eqlshare.com/join/…" autoFocus /></Field></div>
              <div className="mt-8 flex gap-3">
                <Button type="button" variant="secondary" size="lg" onClick={() => { setError(null); setStep("type"); }}>Back</Button>
                <Button type="submit" size="lg" className="flex-1">Preview invite</Button>
              </div>
            </form>
          )}

          {step === "name" && (
            <form onSubmit={createSpace} className="rise">
              <p className="text-[13px] text-muted">{preset.label}</p>
              <h1 className="mt-1 text-[clamp(30px,6vw,40px)] font-semibold tracking-[-0.04em] leading-tight">Name your Space</h1>
              <p className="mt-3 text-[17px] text-muted">Everyone you invite will see this name.</p>
              <div className="mt-8 space-y-4">
                <Field label="Space name" htmlFor="name"><Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required autoFocus placeholder={preset.nameExamples[0]} /></Field>
                <div className="flex flex-wrap gap-2" aria-label="Suggestions">
                  {[...new Set([...preset.nameExamples, "Our Home", "Family Expenses", "Weekend Trip"])].slice(0, 4).map((n) => (
                    <button key={n} type="button" onClick={() => setName(n)} className="h-9 px-3.5 rounded-full text-[14px] ring-1 ring-line bg-surface hover:ring-ink/40 transition">{n}</button>
                  ))}
                </div>
                <div className="flex items-center justify-between rounded-[12px] bg-sunken px-4 h-12 text-[15px]">
                  <span className="text-ink-2">Currency</span><span className="font-medium">USD · US dollar</span>
                </div>
              </div>
              <div className="mt-8 flex gap-3">
                <Button type="button" variant="secondary" size="lg" onClick={() => setStep("type")}>Back</Button>
                <Button type="submit" size="lg" className="flex-1" loading={pending} disabled={!name.trim()}>Create Space</Button>
              </div>
            </form>
          )}

          {step === "invite" && spaceId && (
            <section className="rise">
              <h1 className="text-[clamp(30px,6vw,40px)] font-semibold tracking-[-0.04em] leading-tight">Invite people</h1>
              <p className="mt-3 text-[17px] text-muted">Anyone with this link can ask to join <strong className="text-ink">{name.trim()}</strong>. It expires in 7 days and you can revoke it anytime from Space settings.</p>
              <div className="mt-8">
                {invite ? <CopyField value={invite} label="Invite link" shareText={`Join ${name.trim()} on Eqlshare`} /> : <Notice tone="warning" title="We couldn't create an invite link">You can create one later from Space settings.</Notice>}
              </div>
              <div className="mt-8 flex gap-3">
                <Button variant="secondary" size="lg" onClick={() => setStep("first")}>Skip for now</Button>
                <Button size="lg" className="flex-1" onClick={() => setStep("first")}>Continue</Button>
              </div>
            </section>
          )}

          {step === "first" && spaceId && (
            <section className="rise">
              <h1 className="text-[clamp(30px,6vw,40px)] font-semibold tracking-[-0.04em] leading-tight">How do you want to add your first {preset.expenseNoun}?</h1>
              <p className="mt-3 text-[17px] text-muted">{firstName ? `${firstName}, you` : "You"} can always add more later.</p>
              <div className="mt-8 grid gap-3">
                {(preset.autoBillsFirst
                  ? [["upload", "Upload a PDF statement", "We read the amount and due date, then you check them."], ["forward", "Forward bill emails", "Get a private address for this Space."], ["manual", "Enter it yourself", "Type the amount and choose how to split it."]]
                  : [["manual", "Enter it yourself", "Type the amount and choose how to split it."], ["upload", "Upload a PDF statement", "We read the amount and due date, then you check them."], ["forward", "Forward bill emails", "Get a private address for this Space."]]
                ).map(([k, t, d]) => (
                  <Link key={k} href={k === "manual" ? `/s/${spaceId}/bills/new` : `/s/${spaceId}/auto-bills${k === "forward" ? "#forwarding" : ""}`}
                    className="group flex items-center gap-4 rounded-[18px] p-5 bg-surface ring-1 ring-line hover:ring-ink/40 hover:-translate-y-0.5 transition-all duration-300 ease-out-soft">
                    <span className="flex-1"><span className="block text-[17px] font-semibold tracking-[-0.01em]">{t}</span><span className="block text-[15px] text-muted">{d}</span></span>
                    <span aria-hidden="true" className="text-ink-2 transition-transform duration-300 group-hover:translate-x-1">→</span>
                  </Link>
                ))}
              </div>
              <ButtonLink href={`/s/${spaceId}`} variant="ghost" size="lg" full className="mt-6">Skip, go to my dashboard</ButtonLink>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
