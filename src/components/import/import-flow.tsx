"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { applyImportAction } from "@/lib/actions";
import {
  addGroup, addPerson, buildImportPlan, buildReview, defaultChoice, derive, findDuplicates, lineKey, mergePeople, undoMerge, NO_GROUP,
  type Derived, type DerivedPerson, type DerivedSpace, type DuplicateMatch, type ExistingSpace, type ExtractionResult, type ImageStatus,
  type ReviewState, type SpaceChoice, type SpaceType,
} from "@/lib/domain/import";
import { formatUSD, parseDollars, centsToInput } from "@/lib/domain/money";
import { SPACE_PRESETS, SPACE_TYPES } from "@/lib/domain/spaces";
import { Button, Chip, Input, Logo, Notice, Select, Spinner, cx } from "@/components/ui";
import { FilePicker, type PickedFile } from "@/components/upload/file-picker";
import { AddPersonForm } from "@/components/invite/person-invite";
import { uuid } from "@/lib/uuid";

export type ImportExistingSpace = ExistingSpace & { owner: boolean };
type Step = "guide" | "pick" | "reading" | "found" | "spaces";
type Progress = "waiting" | "reading" | "done" | "failed";

const MAX_IMAGES = 20;
const MAX_BYTES = 10 * 1024 * 1024;
const EMPTY: ExtractionResult = { images: [], lines: [], personTotals: [], groupTotals: [], overall: [], hidden: [], warnings: [] };

/** Screenshots stay readable at ~1600px; shrinking keeps uploads fast on mobile data. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej()), "image/jpeg", 0.85));
  } catch {
    return file; // e.g. HEIC on browsers that can't decode it; the server validates it
  }
}

/** "You owe $400.60" / "Owes you $41.00", always from your side. */
const totalWords = (c: number) => (c < 0 ? `You owe ${formatUSD(-c)}` : c > 0 ? `Owes you ${formatUSD(c)}` : "Settled up");
const overallWords = (c: number) => (c < 0 ? `You owe ${formatUSD(-c)}` : c > 0 ? `You're owed ${formatUSD(c)}` : "All settled up");

export function ImportFlow({ existing, backHref }: { existing: ImportExistingSpace[]; backHref: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("guide");
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [x, setX] = useState<ExtractionResult>(EMPTY);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [choices, setChoices] = useState<Record<string, SpaceChoice>>({});
  const [answers, setAnswers] = useState<Record<string, "same" | "different">>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const reqId = useRef(uuid());

  const d = useMemo(() => (review ? derive(review, x) : null), [review, x]);
  const dups = useMemo(() => (d ? findDuplicates(d.spaces, existing) : []), [d, existing]);

  function startReview(result: ExtractionResult) {
    setX(result);
    setReview(buildReview(result));
    setChoices({});
    setAnswers({});
    setStep("found");
  }

  async function read() {
    setError(null);
    setStep("reading");
    setProgress(files.map(() => "waiting"));
    const form = new FormData();
    for (const f of files) form.append("images", await shrink(f.file), f.file.name);
    let res: Response;
    try {
      res = await fetch("/api/import/extract", { method: "POST", body: form });
    } catch {
      setStep("pick");
      return setError("We couldn't reach the server. Check your connection and try again.");
    }
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({ error: "Something went wrong." }));
      setStep("pick");
      return setError(body.error);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let result: ExtractionResult | null = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.type === "progress") setProgress((p) => p.map((s, i) => (i === msg.index ? msg.status : s)));
        if (msg.type === "result") result = msg.result;
        if (msg.type === "error") { setStep("pick"); return setError(msg.error); }
      }
    }
    if (!result) { setStep("pick"); return setError("We couldn't read your screenshots. Try again, or enter balances manually."); }
    startReview(result);
  }

  const choiceFor = (sp: DerivedSpace) => choices[sp.key] ?? defaultChoice(sp);
  const unanswered = d ? dups.filter((m) => !answers[`${m.spaceKey}|${m.personKey}`] && choiceFor(d.spaces.find((s) => s.key === m.spaceKey)!).include) : [];

  async function confirm() {
    if (!d) return;
    setError(null);
    let plan;
    try {
      const skip = new Set(dups.filter((m) => answers[`${m.spaceKey}|${m.personKey}`] === "same").map((m) => `${m.spaceKey}|${m.personKey}`));
      const existingMembers = Object.fromEntries(existing.filter((e) => e.owner).map((e) => [e.id, e.members.map((m) => ({ id: m.id, name: m.name }))]));
      plan = buildImportPlan(d, Object.fromEntries(d.spaces.map((s) => [s.key, choiceFor(s)])), { imageCount: files.length, skip, existingMembers });
    } catch (e) {
      return setError((e as Error).message);
    }
    setSaving(true);
    const r = await applyImportAction(plan, reqId.current);
    if (!r.ok) { setSaving(false); return setError(r.error); }
    router.push(`/import/invite?batch=${r.data.batchId}`);
  }

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="flex items-center justify-between px-5 sm:px-10 h-16">
        <Logo />
        <Link href={backHref} className="text-[14px] text-ink-2 hover:text-ink">Cancel</Link>
      </header>
      <main className="flex-1 px-4 sm:px-10 pb-40">
        <div className="mx-auto max-w-[720px]">
          {(step === "found" || step === "spaces") && <Steps at={step === "found" ? 1 : 2} />}
          {error && <div className="mb-6"><Notice tone="error" title={error} /></div>}

          {step === "guide" && (
            <section className="rise pt-4">
              <p className="text-[12px] font-medium tracking-[0.16em] text-brand-ink">IMPORT FROM SPLITWISE</p>
              <h1 className="mt-3 text-[clamp(30px,6vw,42px)] font-semibold tracking-[-0.04em] leading-[1.05]">Bring your balances over in a minute</h1>
              <p className="mt-3 text-[17px] text-muted">Two screenshots are usually enough: your Friends tab and your Groups tab.</p>
              <GuideArt />
              <ol className="mt-6 space-y-3 text-[16px]">
                {["Open Splitwise and go to the Friends tab. Take a screenshot.", "Scroll and take another if the list is long.", "Go to the Groups tab and take a screenshot there too.", "Add them all here."].map((t, i) => (
                  <li key={t} className="flex gap-3"><span className="grid place-items-center size-7 shrink-0 rounded-full bg-ink text-white text-[13px] num">{i + 1}</span><span className="pt-0.5">{t}</span></li>
                ))}
              </ol>
              <p className="mt-6 text-[14px] text-muted">We only bring over your own balance with each person, not balances between other people or past expenses. Screenshots aren't stored, and we never ask for your Splitwise login.</p>
              <div className="mt-8 grid gap-3">
                <Button size="lg" full onClick={() => setStep("pick")}>Choose screenshots</Button>
                <Button size="lg" variant="ghost" full onClick={() => startReview(EMPTY)}>Enter balances manually instead</Button>
              </div>
            </section>
          )}

          {step === "pick" && (
            <section className="rise pt-4">
              <h1 className="text-[clamp(28px,6vw,38px)] font-semibold tracking-[-0.04em] leading-tight">Add your screenshots</h1>
              <p className="mt-2 text-muted">Friends tab and Groups tab. Up to {MAX_IMAGES} images, 10 MB each.</p>
              <div className="mt-6">
                <FilePicker files={files} onChange={setFiles} onError={setError} kinds={["image"]} max={MAX_IMAGES} maxBytes={MAX_BYTES} camera label="Screenshot" />
              </div>
              <div className="mt-8 grid gap-3">
                <Button size="lg" full disabled={!files.length} onClick={read}>Read {files.length || ""} {files.length === 1 ? "screenshot" : "screenshots"}</Button>
                <Button size="lg" variant="ghost" full onClick={() => setStep("guide")}>Back</Button>
              </div>
            </section>
          )}

          {step === "reading" && (
            <section className="rise pt-4" aria-live="polite">
              <h1 className="text-[clamp(28px,6vw,38px)] font-semibold tracking-[-0.04em] leading-tight">Reading your screenshots</h1>
              <p className="mt-2 text-muted">This usually takes a few seconds per image.</p>
              <ul className="mt-6 space-y-2">
                {files.map((f, i) => (
                  <li key={f.id} className="flex items-center gap-3 rounded-[14px] bg-surface ring-1 ring-line p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.url ?? undefined} alt="" className="size-12 rounded-[8px] object-cover object-top" />
                    <span className="flex-1 text-[15px]">Screenshot {i + 1}</span>
                    {progress[i] === "done" ? <Chip tone="success">Read</Chip> : progress[i] === "failed" ? <Chip tone="error">Couldn't read</Chip>
                      : progress[i] === "reading" ? <span className="flex items-center gap-2 text-[13px] text-muted"><Spinner />Reading</span> : <span className="text-[13px] text-muted">Waiting</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {step === "found" && review && d && <FoundStep review={review} d={d} images={x.images} warnings={x.warnings} onChange={setReview} />}
          {step === "spaces" && d && (
            <SpacesStep d={d} existing={existing} choiceFor={choiceFor} dups={dups} answers={answers}
              onChoice={(k, c) => setChoices((cs) => ({ ...cs, [k]: c }))} onAnswer={(k, a) => setAnswers((as) => ({ ...as, [k]: a }))} />
          )}
        </div>
      </main>

      {(step === "found" || step === "spaces") && d && (
        <div className="fixed bottom-0 inset-x-0 bg-surface/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto max-w-[720px] px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
            {step === "found" ? (
              <>
                <p className="flex-1 text-[13px] text-muted">{d.blocking[0] ?? `${d.people.length} ${d.people.length === 1 ? "person" : "people"} · ${overallWords(d.overall.ours).toLowerCase()} overall`}</p>
                <Button size="lg" disabled={d.blocking.length > 0} onClick={() => { setError(null); setStep("spaces"); window.scrollTo(0, 0); }}>Looks right</Button>
              </>
            ) : (
              <>
                <p className="flex-1 text-[13px] text-muted">{unanswered.length ? `Answer ${unanswered.length === 1 ? "the question" : `${unanswered.length} questions`} above first` : `${d.spaces.filter((s) => choiceFor(s).include).length} Spaces`}</p>
                <div className="flex gap-2">
                  <Button size="lg" variant="ghost" onClick={() => setStep("found")}>Back</Button>
                  <Button size="lg" className="flex-1" loading={saving} disabled={unanswered.length > 0} onClick={confirm}>Import balances</Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Steps({ at }: { at: 1 | 2 }) {
  return (
    <ol className="flex items-center gap-2 pt-2 pb-4 text-[13px]" aria-label="Steps">
      {["What we found", "Spaces", "Invite"].map((t, i) => (
        <li key={t} className={cx("flex items-center gap-2", i + 1 === at ? "text-ink font-medium" : "text-muted")} aria-current={i + 1 === at ? "step" : undefined}>
          <span className={cx("grid place-items-center size-6 rounded-full text-[12px] num", i + 1 === at ? "bg-ink text-white" : i + 1 < at ? "bg-brand-wash text-brand-ink" : "bg-sunken")}>{i + 1}</span>
          <span className={cx(i + 1 !== at && "hidden sm:inline")}>{t}</span>
          {i < 2 && <span className="w-4 h-px bg-line-strong" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

// ---------- step 1 ----------
function FoundStep({ review, d, images, warnings, onChange }: { review: ReviewState; d: Derived; images: ImageStatus[]; warnings: string[]; onChange: (s: ReviewState) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const o = d.overall;
  const merges = d.people.flatMap((p) => p.merged.map((m) => ({ ...m, into: p.name })));

  return (
    <section className="space-y-5">
      <div className="rise">
        <h1 className="text-[clamp(28px,6vw,38px)] font-semibold tracking-[-0.04em] leading-tight">Here's what we found</h1>
        <p className="mt-2 text-muted">Your balance with each person. Tap someone to fix anything. Nothing is saved until the last step.</p>
      </div>

      <div className="rounded-[20px] bg-night text-white p-5 sm:p-6 grain relative overflow-hidden">
        <p className="text-[14px] text-white/65">Overall</p>
        <p className="mt-1 text-[clamp(26px,6vw,34px)] font-semibold tracking-[-0.03em] num">{overallWords(o.ours)}</p>
        <div className="mt-3">
          {o.matches === true && <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 text-[#7ee2b8] px-3 py-1 text-[14px] font-medium">✓ Matches Splitwise</span>}
          {o.matches === false && <span className="inline-flex rounded-full bg-white/10 text-[#ffcf8a] px-3 py-1 text-[14px] font-medium">Off by {formatUSD(Math.abs(o.offBy))} — something's missing</span>}
          {o.matches === null && <span className="text-[14px] text-white/65">We couldn't see Splitwise's overall total, so we can't double-check it.</span>}
        </div>
        {o.matches === false && <p className="mt-2 text-[13px] text-white/65">Splitwise says {overallWords(o.splitwise!).toLowerCase()}. Check the people marked below, or add a screenshot you missed.</p>}
        {o.splitwiseDisagrees && <p className="mt-2 text-[13px] text-white/65">Your screenshots show different overall totals. They may have been taken at different times.</p>}
      </div>

      <ImageNotes images={images} warnings={warnings} />

      {merges.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Names we merged">
          {merges.map((m) => (
            <li key={m.alias} className="inline-flex items-center gap-1 rounded-full bg-sunken ring-1 ring-line pl-3 pr-1 py-1 text-[13px]">
              <span>Merged: {m.label} = {m.into}</span>
              <button type="button" className="rounded-full px-2 py-0.5 text-ink-2 underline underline-offset-2 hover:bg-surface" onClick={() => onChange(undoMerge(review, m.alias))}>Undo</button>
            </li>
          ))}
        </ul>
      )}

      <ul className="space-y-3">
        {d.people.map((p) => (
          <li key={p.key}>
            {editing === p.key
              ? <PersonEditor review={review} p={p} people={d.people} onChange={onChange} onDone={() => setEditing(null)} />
              : <PersonRow p={p} onEdit={() => setEditing(p.key)} />}
          </li>
        ))}
      </ul>

      {d.people.length === 0 && !adding && <Notice tone="neutral" title="No balances yet">Add each person you have a balance with.</Notice>}
      {adding ? (
        <div className="rounded-[16px] ring-1 ring-line bg-surface p-4">
          <p className="font-semibold mb-3">Add someone new</p>
          <AddPersonForm onCancel={() => setAdding(false)} onAdd={async (name) => {
            const { state, key } = addPerson(review, name);
            onChange(state);
            setAdding(false);
            setEditing(key);
            return null;
          }} />
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setAdding(true)}>+ Add someone new</Button>
      )}
    </section>
  );
}

function PersonRow({ p, onEdit }: { p: DerivedPerson; onEdit: () => void }) {
  const flag = p.gapCents !== 0 || p.lines.some((l) => l.lowConfidence) || p.maybeSameAs.length > 0;
  return (
    <button type="button" onClick={onEdit} className={cx("w-full text-left rounded-[16px] bg-surface ring-1 p-4 hover:ring-ink/30 transition", flag ? "ring-warning/50" : "ring-line")}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[16px] font-semibold truncate">{p.name}</p>
        <p className={cx("text-[15px] font-medium num shrink-0", p.totalCents < 0 ? "text-warning" : p.totalCents > 0 ? "text-brand-ink" : "text-muted")}>{totalWords(p.totalCents)}</p>
      </div>
      <p className="mt-1 text-[14px] text-ink-2 leading-relaxed">
        {p.lines.map((l, i) => {
          const against = Math.sign(l.cents ?? 0) !== Math.sign(p.totalCents);
          return (
            <span key={l.groupKey}>
              {i > 0 && <span className="text-muted"> · </span>}
              {l.groupName} {l.cents === null ? <strong className="text-error">amount needed</strong> : <span className="num">{against ? `(${l.cents < 0 ? "you owe" : "owes you"}) ` : ""}{formatUSD(Math.abs(l.cents))}</span>}
              {l.source === "worked_out" && <span className="ml-1.5 align-middle"><Chip tone="brand">worked out from your totals</Chip></span>}
              {l.otherReading !== null && <span className="ml-1.5 align-middle"><Chip tone="warning">another screenshot says {formatUSD(Math.abs(l.otherReading))}</Chip></span>}
            </span>
          );
        })}
        {!p.lines.length && <span className="text-muted">No balances yet. Tap to add one.</span>}
      </p>
      {p.gapCents !== 0 && <p className="mt-2 text-[13px] text-warning">Splitwise shows {totalWords(p.splitwiseTotal!).toLowerCase()} in total. {formatUSD(Math.abs(p.gapCents))} isn't in any group yet. Tap to add it.</p>}
      {p.maybeSameAs.length > 0 && <p className="mt-2 text-[13px] text-warning">Might be the same person as {p.maybeSameAs.join(" or ")}. Tap to merge.</p>}
    </button>
  );
}

function PersonEditor({ review, p, people, onChange, onDone }: { review: ReviewState; p: DerivedPerson; people: DerivedPerson[]; onChange: (s: ReviewState) => void; onDone: () => void }) {
  const [newGroup, setNewGroup] = useState<{ from: string; name: string } | null>(null);
  const setLine = (groupKey: string, cents: number | null) => onChange({ ...review, edits: { ...review.edits, [lineKey(p.key, groupKey)]: cents } });
  const moveLine = (from: string, to: string, cents: number | null) => {
    if (from !== to) onChange({ ...review, edits: { ...review.edits, [lineKey(p.key, from)]: null, [lineKey(p.key, to)]: cents } });
  };
  const used = new Set(p.lines.map((l) => l.groupKey));
  const free = [NO_GROUP, ...review.groups.map((g) => g.key)].find((g) => !used.has(g));
  // A new line starts at the unexplained gap, or $0 (which blocks the import until it's filled in)
  return (
    <div className="rounded-[16px] bg-surface ring-2 ring-ink/80 p-4 space-y-4">
      <div>
        <label htmlFor={`name-${p.key}`} className="text-[13px] font-medium text-ink-2">Name</label>
        <Input id={`name-${p.key}`} className="mt-1" value={p.name} maxLength={80}
          onChange={(e) => onChange({ ...review, people: review.people.map((x) => (x.key === p.key ? { ...x, name: e.target.value } : x)) })} />
      </div>

      <ul className="space-y-3">
        {p.lines.map((l) => {
          const c = l.cents ?? 0;
          const sign = (l.cents ?? 0) < 0 ? -1 : 1;
          return (
            <li key={l.groupKey} className="rounded-[12px] bg-sunken/60 p-3 space-y-2">
              <div className="flex gap-2">
                <Select aria-label="Group" value={l.groupKey} className="flex-1 min-w-0" onChange={(e) => (e.target.value === "__new" ? setNewGroup({ from: l.groupKey, name: "" }) : moveLine(l.groupKey, e.target.value, l.cents))}>
                  <option value={NO_GROUP}>Not in a group</option>
                  {review.groups.map((g) => <option key={g.key} value={g.key} disabled={g.key !== l.groupKey && used.has(g.key)}>{g.name}</option>)}
                  <option value="__new">New group…</option>
                </Select>
                <button type="button" aria-label={`Remove ${l.groupName}`} className="grid place-items-center size-10 shrink-0 rounded-[10px] text-ink-2 hover:bg-surface" onClick={() => setLine(l.groupKey, null)}>×</button>
              </div>
              {newGroup?.from === l.groupKey && (
                <div className="flex gap-2">
                  <Input aria-label="New group name" autoFocus value={newGroup.name} maxLength={60} placeholder="Group name" onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })} />
                  <Button size="sm" disabled={!newGroup.name.trim()} onClick={() => {
                    const { state, key } = addGroup(review, newGroup.name);
                    onChange({ ...state, edits: { ...state.edits, [lineKey(p.key, l.groupKey)]: null, [lineKey(p.key, key)]: l.cents } });
                    setNewGroup(null);
                  }}>Add</Button>
                </div>
              )}
              <div className="flex gap-2 items-center">
                <div role="radiogroup" aria-label="Direction" className="flex rounded-[10px] ring-1 ring-line-strong overflow-hidden text-[14px] shrink-0">
                  {([[1, "Owes you"], [-1, "You owe"]] as const).map(([v, t]) => (
                    <button key={t} type="button" role="radio" aria-checked={sign === v} className={cx("px-3 h-10", sign === v ? "bg-ink text-white" : "bg-surface")}
                      onClick={() => setLine(l.groupKey, l.cents === null ? null : v * Math.abs(c))}>{t}</button>
                  ))}
                </div>
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
                  <AmountInput cents={l.cents === null ? null : Math.abs(c)} onChange={(v) => setLine(l.groupKey, v === null ? null : sign * v)} />
                </div>
              </div>
              {l.source === "worked_out" && <p className="text-[13px] text-brand-ink">Worked out from your totals: no screenshot showed this line, but it's the only amount that makes Splitwise's totals add up. Check it.</p>}
              {l.otherReading !== null && <p className="text-[13px] text-warning">Another screenshot shows {formatUSD(Math.abs(l.otherReading))}. We kept the Friends tab amount.</p>}
            </li>
          );
        })}
      </ul>
      {free !== undefined && <Button size="sm" variant="secondary" onClick={() => onChange({ ...review, edits: { ...review.edits, [lineKey(p.key, free)]: p.gapCents } })}>+ Add a balance</Button>}
      {p.gapCents !== 0 && <p className="text-[13px] text-warning">Splitwise's total for {p.name.split(" ")[0]} is {formatUSD(Math.abs(p.splitwiseTotal!))} ({p.splitwiseTotal! < 0 ? "you owe" : "owes you"}). The balances here add up to {formatUSD(Math.abs(p.totalCents))}.</p>}

      {people.length > 1 && (
        <div>
          <label htmlFor={`merge-${p.key}`} className="text-[13px] font-medium text-ink-2">Same person as…</label>
          <Select id={`merge-${p.key}`} className="mt-1" value="" onChange={(e) => { if (e.target.value) { onChange(mergePeople(review, p.key, e.target.value)); onDone(); } }}>
            <option value="">Not merged</option>
            {people.filter((o) => o.key !== p.key).map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
          </Select>
        </div>
      )}
      <div className="flex flex-wrap justify-between gap-2 pt-1">
        <Button variant="ghost" className="text-error" onClick={() => { onChange({ ...review, people: review.people.map((x) => (x.key === p.key ? { ...x, removed: true } : x)) }); onDone(); }}>Don't import {p.name.split(" ")[0] || "them"}</Button>
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

// ---------- step 2 ----------
function SpacesStep({ d, existing, choiceFor, dups, answers, onChoice, onAnswer }: {
  d: Derived; existing: ImportExistingSpace[]; choiceFor: (s: DerivedSpace) => SpaceChoice; dups: DuplicateMatch[];
  answers: Record<string, "same" | "different">; onChoice: (key: string, c: SpaceChoice) => void; onAnswer: (key: string, a: "same" | "different") => void;
}) {
  const owned = existing.filter((e) => e.owner);
  return (
    <section className="space-y-5">
      <div className="rise">
        <h1 className="text-[clamp(28px,6vw,38px)] font-semibold tracking-[-0.04em] leading-tight">We'll create these Spaces</h1>
        <p className="mt-2 text-muted">One for each group. A balance outside any group gets its own 2-person Space, so nobody sees anyone else's.</p>
      </div>
      <ul className="space-y-3">
        {d.spaces.map((sp) => {
          const c = choiceFor(sp);
          const t = c.target;
          const matches = dups.filter((m) => m.spaceKey === sp.key);
          return (
            <li key={sp.key} className={cx("rounded-[16px] bg-surface ring-1 ring-line p-4 space-y-3", !c.include && "opacity-60")}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  {t.kind === "new" ? (
                    <Input aria-label="Space name" value={t.name} maxLength={60} className="font-semibold" onChange={(e) => onChoice(sp.key, { ...c, target: { ...t, name: e.target.value } })} />
                  ) : <p className="font-semibold pt-2">{existing.find((e) => e.id === t.spaceId)?.name}</p>}
                  <p className="mt-1.5 text-[13px] text-muted">{sp.people.length + 1} people · You, {sp.people.map((p) => p.name.split(" ")[0]).join(", ")}</p>
                </div>
                <label className="flex items-center gap-2 pt-2.5 text-[13px] text-ink-2 shrink-0">
                  <input type="checkbox" checked={c.include} onChange={(e) => onChoice(sp.key, { ...c, include: e.target.checked })} className="accent-[var(--ink)] size-4" />Import
                </label>
              </div>
              {c.include && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {owned.length > 0 && (
                    <Select aria-label="Where" value={t.kind === "new" ? "" : t.spaceId}
                      onChange={(e) => onChoice(sp.key, { ...c, target: e.target.value ? { kind: "existing", spaceId: e.target.value } : { kind: "new", name: sp.name, type: sp.pair ? "group" : "shared_home" } })}>
                      <option value="">New Space</option>
                      {owned.map((e) => <option key={e.id} value={e.id}>Add to {e.name}</option>)}
                    </Select>
                  )}
                  {t.kind === "new" && (
                    <Select aria-label="Space type" value={t.type} onChange={(e) => onChoice(sp.key, { ...c, target: { ...t, type: e.target.value as SpaceType } })}>
                      {SPACE_TYPES.map((k) => <option key={k} value={k}>{SPACE_PRESETS[k].label}</option>)}
                    </Select>
                  )}
                </div>
              )}
              {c.include && matches.map((m) => {
                const k = `${m.spaceKey}|${m.personKey}`;
                return (
                  <div key={k} className="rounded-[12px] bg-warning-wash/60 ring-1 ring-warning/30 p-3 text-[14px] space-y-2">
                    <p><strong>Already in {m.existing.spaceName}:</strong> your balance with {m.existing.memberName} there is {m.existing.cents === 0 ? "settled" : totalWords(m.existing.cents).toLowerCase()}. Splitwise shows {totalWords(m.importCents).toLowerCase()}. Is this the same balance?</p>
                    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`Is ${m.personName}'s balance already in ${m.existing.spaceName}?`}>
                      <Button size="sm" role="radio" aria-checked={answers[k] === "same"} variant={answers[k] === "same" ? "primary" : "secondary"} onClick={() => onAnswer(k, "same")}>Same, don't add it again</Button>
                      <Button size="sm" role="radio" aria-checked={answers[k] === "different"} variant={answers[k] === "different" ? "primary" : "secondary"} onClick={() => onAnswer(k, "different")}>Different, add it</Button>
                    </div>
                  </div>
                );
              })}
            </li>
          );
        })}
      </ul>
      <p className="text-[13px] text-muted">You can change a Space's type later in its settings.</p>
    </section>
  );
}

function ImageNotes({ images, warnings }: { images: ImageStatus[]; warnings: string[] }) {
  const notes = images.flatMap((im) => [
    ...(im.error ? [{ tone: "error" as const, text: `Screenshot ${im.index + 1}: ${im.error}` }] : []),
    ...(im.duplicateOf !== null ? [{ tone: "neutral" as const, text: `Screenshot ${im.index + 1} is the same as screenshot ${im.duplicateOf + 1}, so we skipped it.` }] : []),
    ...im.warnings.map((w) => ({ tone: "warning" as const, text: `Screenshot ${im.index + 1}: ${w}` })),
  ]);
  if (!notes.length && !warnings.length) return null;
  return (
    <div className="rounded-[16px] ring-1 ring-warning/30 bg-warning-wash/50 p-4 space-y-1.5">
      {notes.map((n, i) => <p key={i} className={cx("text-[14px]", n.tone === "error" ? "text-error" : n.tone === "warning" ? "text-warning" : "text-ink-2")}>{n.text}</p>)}
      {warnings.map((w) => <p key={w} className="text-[14px] text-ink-2">{w}</p>)}
    </div>
  );
}

function AmountInput({ cents, onChange, disabled }: { cents: number | null; onChange: (c: number | null) => void; disabled?: boolean }) {
  const [text, setText] = useState(cents === null ? "" : centsToInput(cents));
  const [last, setLast] = useState(cents);
  if (cents !== last) {
    setLast(cents);
    if (cents === null || parseDollars(text) !== cents) setText(cents === null ? "" : centsToInput(cents));
  }
  return (
    <input inputMode="decimal" aria-label="Amount" value={text} disabled={disabled} placeholder="0.00"
      onChange={(e) => {
        const v = e.target.value.replace(/[^\d.]/g, "");
        setText(v);
        const c = v === "" ? null : parseDollars(v);
        setLast(c);
        onChange(c);
      }}
      className="w-full h-10 rounded-[12px] bg-surface ring-1 ring-inset ring-line-strong pl-7 pr-3 text-right num text-[16px] focus:outline-none focus:ring-2 focus:ring-brand-strong disabled:opacity-50" />
  );
}

function GuideArt() {
  return (
    <svg className="mt-8 w-full max-w-[420px]" viewBox="0 0 420 200" role="img" aria-label="Your Splitwise Friends tab becoming opening balances">
      <rect x="20" y="10" width="120" height="180" rx="18" fill="var(--surface)" stroke="var(--line-strong)" strokeWidth="2" />
      <rect x="38" y="32" width="72" height="8" rx="4" fill="var(--ink)" />
      <rect x="38" y="48" width="40" height="6" rx="3" fill="var(--line-strong)" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <circle cx="46" cy={80 + i * 24} r="7" fill="var(--sunken)" stroke="var(--line-strong)" />
          <rect x="60" y={76 + i * 24} width="40" height="6" rx="3" fill="var(--line-strong)" />
          <rect x="106" y={76 + i * 24} width="18" height="6" rx="3" fill={i % 2 ? "var(--brand)" : "var(--warning)"} opacity=".7" />
        </g>
      ))}
      <path d="M160 100h60" stroke="var(--brand)" strokeWidth="2" strokeDasharray="4 5" />
      <path d="M212 94l8 6-8 6" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="240" y="40" width="160" height="120" rx="18" fill="var(--night)" />
      <text x="258" y="70" fill="#ffffff" opacity=".6" fontSize="11" fontFamily="var(--font-geist)">Your balances</text>
      <text x="258" y="100" fill="#ffffff" fontSize="15" fontFamily="var(--font-geist)">Alex owes you</text>
      <text x="258" y="126" fill="var(--brand)" fontSize="22" fontFamily="var(--font-serif)">$42.50</text>
    </svg>
  );
}
