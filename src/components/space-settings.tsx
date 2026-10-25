"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addPersonAction, createInviteAction, createPersonClaimAction, deactivateMemberAction, revokeInviteAction, revokePersonClaimsAction, setRoleAction, updateNameAction, updatePrefsAction, updateSpaceAction, type Result,
} from "@/lib/actions";
import { AddPersonForm, PersonInvite } from "./invite/person-invite";
import { SPACE_PRESETS, SPACE_TYPES, type SpaceType } from "@/lib/domain/spaces";
import { Avatar, Button, Chip, Field, Input, Notice, Select, cx } from "./ui";
import { CopyField } from "./copy-field";

function useRun() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return {
    error, ok, pending,
    run(fn: () => Promise<Result<unknown>>, success?: string, after?: (r: Result<unknown>) => void) {
      setError(null); setOk(null);
      start(async () => {
        const r = await fn();
        if (!r.ok) return setError(r.error);
        if (success) setOk(success);
        after?.(r);
        router.refresh();
      });
    },
  };
}

export function SpaceDetails({ spaceId, name: n0, type: t0, defaultSplit: d0, canEdit }: { spaceId: string; name: string; type: SpaceType; defaultSplit: string; canEdit: boolean }) {
  const [name, setName] = useState(n0);
  const [type, setType] = useState<SpaceType>(t0);
  const [split, setSplit] = useState(d0);
  const r = useRun();
  const dirty = name !== n0 || type !== t0 || split !== d0;
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); r.run(() => updateSpaceAction(spaceId, { name, type, defaultSplit: split }), "Saved"); }}>
      {r.error && <Notice tone="error" title={r.error} />}
      <Field label="Space name" htmlFor="sp-name"><Input id="sp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} disabled={!canEdit} /></Field>
      <fieldset disabled={!canEdit}>
        <legend className="text-[13px] font-medium text-ink-2 mb-2">Space type</legend>
        <div className="grid sm:grid-cols-2 gap-2">
          {SPACE_TYPES.map((t) => (
            <label key={t} className={cx("flex items-start gap-3 rounded-[14px] p-3.5 cursor-pointer ring-1 transition-all", type === t ? "ring-2 ring-ink bg-surface" : "ring-line bg-surface hover:ring-line-strong")}>
              <input type="radio" name="sp-type" value={t} checked={type === t} onChange={() => setType(t)} className="mt-1 accent-[var(--ink)]" />
              <span><span className="block text-[15px] font-medium">{SPACE_PRESETS[t].label}</span><span className="block text-[13px] text-muted">{SPACE_PRESETS[t].blurb}</span></span>
            </label>
          ))}
        </div>
        <p className="text-[13px] text-muted mt-2">Changing the type only changes labels and suggested defaults. Existing bills, shares and payments stay exactly as they are.</p>
      </fieldset>
      <Field label="Default split for new bills" htmlFor="sp-split" hint="Only used for new bills. You can change it on any bill.">
        <Select id="sp-split" value={split} onChange={(e) => setSplit(e.target.value)} disabled={!canEdit}>
          <option value="equal">Equally</option><option value="exact">Exact amounts</option><option value="percent">Percentages</option>
        </Select>
      </Field>
      <div className="flex items-center gap-3">
        <Button disabled={!canEdit || !dirty} loading={r.pending}>Save changes</Button>
        {r.ok && !dirty && <span role="status" className="text-[14px] text-success">Saved</span>}
        {!canEdit && <span className="text-[13px] text-muted">Only owners can change Space settings.</span>}
      </div>
    </form>
  );
}

type MemberRow = { id: string; name: string; role: string; status: string; joined: string; left: string | null; placeholder: boolean; personId: string | null };

export function Members({ spaceId, spaceName, members, meId, isOwner }: { spaceId: string; spaceName: string; meId: string | null; isOwner: boolean; members: MemberRow[] }) {
  const router = useRouter();
  const r = useRun();
  const [confirm, setConfirm] = useState<string | null>(null);
  // Personal links by person; each is shared on its own, never pasted together into one message
  const [links, setLinks] = useState<Record<string, string>>({});
  const [contacts, setContacts] = useState<Record<string, { phone?: string; email?: string }>>({});
  const [busyAll, setBusyAll] = useState(false);
  const [adding, setAdding] = useState(false);
  const pending = members.filter((m) => m.placeholder && m.status === "active" && m.personId);

  async function inviteAll() {
    setBusyAll(true);
    const next = { ...links };
    for (const m of pending) {
      if (next[m.personId!]) continue;
      const res = await createPersonClaimAction(m.personId!);
      if (res.ok) next[m.personId!] = res.data.url;
    }
    setLinks(next);
    setBusyAll(false);
  }
  const create = (personId: string) => async () => {
    const res = await createPersonClaimAction(personId);
    if (res.ok) setLinks((l) => ({ ...l, [personId]: res.data.url }));
    return res;
  };

  return (
    <div>
      {r.error && <div className="mb-3"><Notice tone="error" title={r.error} /></div>}
      {isOwner && pending.length > 0 && (
        <div className="mb-4 rounded-[14px] bg-teal-wash/60 ring-1 ring-teal/20 p-4 flex flex-wrap items-center gap-3">
          <p className="flex-1 min-w-[200px] text-[14px] text-ink-2"><strong className="text-ink">{pending.length} {pending.length === 1 ? "person hasn't" : "people haven't"} joined.</strong> Each gets a personal link to their own balances. Send each one only to that person.</p>
          <Button size="sm" loading={busyAll} onClick={inviteAll}>Invite all</Button>
        </div>
      )}
      <ul className="divide-y divide-line">
        {members.map((m) => {
          const me = m.id === meId;
          const link = m.personId ? links[m.personId] : undefined;
          return (
            <li key={m.id} className="py-3.5 flex flex-wrap items-center gap-3">
              <Avatar name={m.name} size={36} muted={m.status === "inactive" || m.placeholder} />
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium truncate">{m.name}{me && <span className="text-muted font-normal"> (you)</span>}</p>
                <p className="text-[13px] text-muted">{m.status === "inactive" ? `Left ${m.left?.slice(0, 10)}` : m.placeholder ? "Hasn't joined yet" : `Joined ${m.joined.slice(0, 10)}`}</p>
              </div>
              {m.status === "inactive" ? <Chip>Former member</Chip> : m.placeholder ? <Chip tone="warning">Not joined</Chip> : m.role === "owner" ? <Chip tone="teal">Owner</Chip> : <Chip>Member</Chip>}
              {m.status === "active" && m.placeholder && isOwner && m.personId && (
                <PersonInvite name={m.name} spaceNames={[spaceName]} url={link ?? null} onCreate={create(m.personId)} contact={contacts[m.personId]} />
              )}
              {m.status === "active" && (isOwner || me) && (
                confirm === m.id ? (
                  <div className="w-full flex flex-wrap items-center gap-2 rounded-[12px] bg-sunken p-3 text-[14px]">
                    <span className="flex-1 min-w-[200px]">{me ? "Leave this Space? Your past bills and anything you still owe stay on record." : `Remove ${m.name}? Their history and balances stay, and new bills won't include them.`}</span>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                    <Button size="sm" variant="danger" loading={r.pending} onClick={() => r.run(() => deactivateMemberAction(spaceId, m.id, me))}>{me ? "Leave" : "Remove"}</Button>
                  </div>
                ) : (
                  <div className="flex gap-1">
                    {isOwner && !me && !m.placeholder && <Button size="sm" variant="ghost" onClick={() => r.run(() => setRoleAction(spaceId, m.id, m.role === "owner" ? "member" : "owner"))}>{m.role === "owner" ? "Make member" : "Make owner"}</Button>}
                    <Button size="sm" variant="ghost" className="text-error" onClick={() => setConfirm(m.id)}>{me ? "Leave" : "Remove"}</Button>
                  </div>
                )
              )}
              {link && m.personId && (
                <p className="w-full pl-12 text-[12px] text-muted">Works once, for {m.name} only, for 14 days, and covers every Space they're in. Creating a new link cancels this one.{" "}
                  <button type="button" className="underline underline-offset-2" onClick={() => r.run(() => revokePersonClaimsAction(spaceId, m.personId!), undefined, () => setLinks((l) => { const n = { ...l }; delete n[m.personId!]; return n; }))}>Revoke</button>
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {isOwner && (
        <div className="mt-4">
          {adding ? (
            <div className="rounded-[16px] ring-1 ring-line bg-surface p-4">
              <p className="font-semibold mb-3">Add someone new</p>
              <AddPersonForm submitLabel="Add and invite" onCancel={() => setAdding(false)} onAdd={async (name, contact) => {
                const res = await addPersonAction(spaceId, name);
                if (!res.ok) return res.error;
                const link = await createPersonClaimAction(res.data.personId);
                if (link.ok) setLinks((l) => ({ ...l, [res.data.personId]: link.data.url }));
                if (contact.phone || contact.email) setContacts((c) => ({ ...c, [res.data.personId]: contact }));
                setAdding(false);
                router.refresh();
                return null;
              }} />
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setAdding(true)}>+ Add someone new</Button>
          )}
        </div>
      )}
    </div>
  );
}

export function Invites({ spaceId, spaceName, invites }: { spaceId: string; spaceName: string; invites: { id: string; expires_at: string; use_count: number; max_uses: number }[] }) {
  const r = useRun();
  const [link, setLink] = useState<string | null>(null);
  return (
    <div className="space-y-4">
      {r.error && <Notice tone="error" title={r.error} />}
      {link ? <CopyField label="New invite link" value={link} shareText={`Join ${spaceName} on Eqlshare`} />
        : <Button variant="secondary" loading={r.pending} onClick={() => r.run(() => createInviteAction(spaceId), undefined, (res) => res.ok && setLink((res.data as { url: string }).url))}>Create invite link</Button>}
      <p className="text-[13px] text-muted">Links expire after 7 days and work for up to 10 people. For security we only show a link once. Create a new one anytime.</p>
      {invites.length > 0 && (
        <ul className="divide-y divide-line rounded-[14px] ring-1 ring-line">
          {invites.map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-3 text-[14px]">
              <span className="flex-1">Link created · expires {new Date(i.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} · used {i.use_count} of {i.max_uses}</span>
              <Button size="sm" variant="ghost" className="text-error" onClick={() => r.run(() => revokeInviteAction(spaceId, i.id))}>Revoke</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Notifications({ spaceId, prefs }: { spaceId: string; prefs: { bill_arrival: boolean; reminder_days: number[]; reminders_opt_out: boolean } }) {
  const [arrival, setArrival] = useState(prefs.bill_arrival);
  const [days, setDays] = useState<number[]>(prefs.reminder_days);
  const [optOut, setOptOut] = useState(prefs.reminders_opt_out);
  const r = useRun();
  const toggle = (d: number) => setDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d]));
  return (
    <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); r.run(() => updatePrefsAction(spaceId, { billArrival: arrival, days, optOut }), "Saved"); }}>
      {r.error && <Notice tone="error" title={r.error} />}
      <Toggle id="n-arr" label="When a new bill is added" checked={arrival} onChange={setArrival} />
      <fieldset>
        <legend className="text-[14px] font-medium mb-2">Due date reminders</legend>
        <div className="flex flex-wrap gap-2">
          {[7, 5, 3, 2, 1, 0].map((d) => (
            <button key={d} type="button" aria-pressed={days.includes(d)} onClick={() => toggle(d)}
              className={cx("h-9 px-3.5 rounded-full text-[14px] transition", days.includes(d) ? "bg-ink text-white" : "bg-surface ring-1 ring-line-strong text-ink-2")}>
              {d === 0 ? "On the day" : `${d} day${d === 1 ? "" : "s"} before`}
            </button>
          ))}
        </div>
      </fieldset>
      <Toggle id="n-opt" label="Don't let members send me reminders" checked={optOut} onChange={setOptOut} />
      <p className="text-[13px] text-muted">Email delivery isn't switched on during the beta. Reminders show in the app, and the person you owe can share a reminder link with you.</p>
      <div className="flex items-center gap-3"><Button loading={r.pending}>Save preferences</Button>{r.ok && <span role="status" className="text-[14px] text-success">Saved</span>}</div>
    </form>
  );
}

function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex items-center justify-between gap-4 cursor-pointer">
      <span className="text-[15px]">{label}</span>
      <span className="relative inline-flex">
        <input id={id} type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
        <span className="w-11 h-[26px] rounded-full bg-line-strong peer-checked:bg-teal transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-teal peer-focus-visible:ring-offset-2" />
        <span className="absolute top-[3px] left-[3px] size-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-[18px]" />
      </span>
    </label>
  );
}

export function DisplayName({ spaceId, name }: { spaceId: string; name: string }) {
  const [v, setV] = useState(name);
  const r = useRun();
  return (
    <form className="flex items-end gap-3" onSubmit={(e) => { e.preventDefault(); r.run(() => updateNameAction(spaceId, v), "Saved"); }}>
      <div className="flex-1"><Field label="Your name" htmlFor="me-name" error={r.error}><Input id="me-name" value={v} onChange={(e) => setV(e.target.value)} maxLength={80} /></Field></div>
      <Button variant="secondary" disabled={v === name} loading={r.pending}>Save</Button>
    </form>
  );
}
