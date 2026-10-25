"use client";

import { useState } from "react";
import { createPersonClaimAction } from "@/lib/actions";
import { Avatar, Button, ButtonLink, Chip, Logo, Notice, cx } from "@/components/ui";
import { PersonInvite } from "@/components/invite/person-invite";

type Person = { id: string; name: string; claimed: boolean; spaces: { id: string; name: string }[] };

/** Step 3: each person once, however many Spaces they're in. One personal link covers all of them. */
export function InvitePeople({ people, doneHref }: { people: Person[]; doneHref: string }) {
  const [links, setLinks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const waiting = people.filter((p) => !p.claimed && p.spaces.length);

  async function inviteAll() {
    setBusy(true); setError(null);
    const next = { ...links };
    for (const p of waiting) {
      if (next[p.id]) continue;
      const r = await createPersonClaimAction(p.id);
      if (r.ok) next[p.id] = r.data.url; else setError(r.error);
    }
    setLinks(next);
    setBusy(false);
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="flex items-center justify-between px-5 sm:px-10 h-16"><Logo /></header>
      <main className="flex-1 px-4 sm:px-10 pb-16">
        <div className="mx-auto max-w-[720px]">
          <ol className="flex items-center gap-2 pt-2 pb-4 text-[13px]" aria-label="Steps">
            {["What we found", "Spaces", "Invite"].map((t, i) => (
              <li key={t} className={cx("flex items-center gap-2", i === 2 ? "text-ink font-medium" : "text-muted")} aria-current={i === 2 ? "step" : undefined}>
                <span className={cx("grid place-items-center size-6 rounded-full text-[12px] num", i === 2 ? "bg-ink text-white" : "bg-brand-wash text-brand-ink")}>{i < 2 ? "✓" : 3}</span>
                <span className={cx(i !== 2 && "hidden sm:inline")}>{t}</span>
                {i < 2 && <span className="w-4 h-px bg-line-strong" aria-hidden="true" />}
              </li>
            ))}
          </ol>
          <section className="rise space-y-5">
            <div>
              <h1 className="text-[clamp(28px,6vw,38px)] font-semibold tracking-[-0.04em] leading-tight">Invite your people</h1>
              <p className="mt-2 text-muted">Your balances are in. Each person gets one personal link that connects them to all of their Spaces at once. Send each link only to that person.</p>
            </div>
            {error && <Notice tone="error" title={error} />}
            {waiting.length > 1 && (
              <div className="rounded-[14px] bg-brand-wash/60 ring-1 ring-brand-strong/20 p-4 flex flex-wrap items-center gap-3">
                <p className="flex-1 min-w-[200px] text-[14px] text-ink-2">Get every link ready, then share each one.</p>
                <Button size="sm" loading={busy} onClick={inviteAll}>Invite all</Button>
              </div>
            )}
            <ul className="divide-y divide-line rounded-[16px] bg-surface ring-1 ring-line px-4">
              {people.map((p) => (
                <li key={p.id} className="py-4 flex flex-wrap items-center gap-3">
                  <Avatar name={p.name} size={40} muted />
                  <div className="flex-1 min-w-[160px]">
                    <p className="text-[15px] font-medium">{p.name}</p>
                    <p className="text-[13px] text-muted">{p.spaces.map((s) => s.name).join(" · ") || "No Spaces"}</p>
                  </div>
                  {p.claimed ? <Chip tone="success">Joined</Chip>
                    : p.spaces.length > 0 && <PersonInvite name={p.name} spaceNames={p.spaces.map((s) => s.name)} url={links[p.id] ?? null}
                      onCreate={async () => { const r = await createPersonClaimAction(p.id); if (r.ok) setLinks((l) => ({ ...l, [p.id]: r.data.url })); return r; }} />}
                </li>
              ))}
            </ul>
            {people.length === 0 && <Notice tone="neutral" title="Nobody to invite">Every balance went to people who are already members.</Notice>}
            <p className="text-[13px] text-muted">Links work once, for 14 days. You can make a new one any time from a Space's Members list, which cancels the old one.</p>
            <ButtonLink href={doneHref} size="lg" variant={Object.keys(links).length ? "primary" : "secondary"} full>Done</ButtonLink>
          </section>
        </div>
      </main>
    </div>
  );
}
