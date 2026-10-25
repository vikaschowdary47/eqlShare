"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { applyImportAction } from "@/lib/actions";
import {
  buildImportPlan, checkGroup, resolveKey, toReviewGroups,
  type ExtractionResult, type ImageStatus, type ReviewGroup, type ReviewPerson,
} from "@/lib/domain/import";
import { formatUSD, parseDollars, centsToInput } from "@/lib/domain/money";
import { SPACE_PRESETS, SPACE_TYPES, type SpaceType } from "@/lib/domain/spaces";
import { Button, Chip, Input, Logo, Notice, Select, Spinner, cx } from "@/components/ui";
import { FilePicker, type PickedFile } from "@/components/upload/file-picker";

export interface OwnedSpace { id: string; name: string; members: { id: string; name: string; isMe: boolean }[] }
type Step = "guide" | "pick" | "reading" | "review";
type Progress = "waiting" | "reading" | "done" | "failed";

const MAX_IMAGES = 20;
const MAX_BYTES = 10 * 1024 * 1024;

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

let personSeq = 0;
const newPerson = (name = ""): ReviewPerson => ({ key: `m${++personSeq}`, name, netCents: null, currency: "USD", lowConfidence: false, mapping: { kind: "placeholder" } });
const emptyGroup = (): ReviewGroup => ({
  key: `manual${++personSeq}`, include: true, target: { kind: "new", name: "", type: "shared_home" }, lowConfidenceName: false, sourceImages: [], acknowledgedImbalance: false,
  people: [{ ...newPerson("You"), mapping: { kind: "me" }, netCents: 0 }, newPerson()],
});

export function ImportFlow({ spaces, backHref }: { spaces: OwnedSpace[]; backHref: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("guide");
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [images, setImages] = useState<ImageStatus[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [groups, setGroups] = useState<ReviewGroup[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const reqId = useRef(crypto.randomUUID());

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
    setImages(result.images);
    setWarnings(result.warnings);
    const g = toReviewGroups(result);
    setGroups(g.length ? g : [emptyGroup()]);
    setStep("review");
  }

  const checks = useMemo(() => groups.map((g) => checkGroup(g)), [groups]);
  const included = groups.filter((g) => g.include);
  const ready = included.length > 0 && groups.every((g, i) => !g.include || (checks[i].errors.length === 0 && (checks[i].balanced || g.acknowledgedImbalance)
    && (g.target.kind === "existing" || g.target.name.trim().length > 0)));

  function update(gi: number, fn: (g: ReviewGroup) => ReviewGroup) {
    setGroups((gs) => gs.map((g, i) => (i === gi ? fn(g) : g)));
  }

  async function confirm() {
    setError(null);
    let plan;
    try {
      plan = buildImportPlan(groups, files.length);
    } catch (e) {
      return setError((e as Error).message);
    }
    setSaving(true);
    const r = await applyImportAction(plan, reqId.current);
    setSaving(false);
    if (!r.ok) return setError(r.error);
    router.push(`/s/${r.data.spaceIds[0]}/space?import=${r.data.batchId}#members`);
  }

  const totalTransfers = included.reduce((a, g) => a + checks[groups.indexOf(g)].transfers.length, 0);
  const totalPlaceholders = included.reduce((a, g) => a + g.people.filter((p) => resolveKey(g.people, p.key) === p.key && p.mapping.kind === "placeholder").length, 0);

  return (
    <div className="min-h-dvh flex flex-col">
      <header className="flex items-center justify-between px-5 sm:px-10 h-16">
        <Logo />
        <Link href={backHref} className="text-[14px] text-ink-2 hover:text-ink">Cancel</Link>
      </header>
      <main className="flex-1 px-4 sm:px-10 pb-36">
        <div className="mx-auto max-w-[720px]">
          {error && <div className="mb-6"><Notice tone="error" title={error} /></div>}

          {step === "guide" && (
            <section className="rise pt-4">
              <p className="text-[12px] font-medium tracking-[0.16em] text-teal-ink">IMPORT FROM SPLITWISE</p>
              <h1 className="mt-3 text-[clamp(30px,6vw,42px)] font-semibold tracking-[-0.04em] leading-[1.05]">Bring your balances over in a minute</h1>
              <p className="mt-3 text-[17px] text-muted">Open each group in Splitwise and screenshot the balances. Add as many screenshots as you need.</p>
              <GuideArt />
              <ol className="mt-6 space-y-3 text-[16px]">
                {["Open Splitwise and tap a group.", "Tap Balances.", "Take a screenshot. Scroll and take another if the list is long.", "Repeat for each group you want to bring over."].map((t, i) => (
                  <li key={t} className="flex gap-3"><span className="grid place-items-center size-7 shrink-0 rounded-full bg-ink text-white text-[13px] num">{i + 1}</span><span className="pt-0.5">{t}</span></li>
                ))}
              </ol>
              <p className="mt-6 text-[14px] text-muted">We only read the names and balances. Screenshots aren't stored, and we never ask for your Splitwise login. Only balances come over, not past expenses.</p>
              <div className="mt-8 grid gap-3">
                <Button size="lg" full onClick={() => setStep("pick")}>Choose screenshots</Button>
                <Button size="lg" variant="ghost" full onClick={() => { setGroups([emptyGroup()]); setStep("review"); }}>Enter balances manually instead</Button>
              </div>
            </section>
          )}

          {step === "pick" && (
            <section className="rise pt-4">
              <h1 className="text-[clamp(28px,6vw,38px)] font-semibold tracking-[-0.04em] leading-tight">Add your screenshots</h1>
              <p className="mt-2 text-muted">Up to {MAX_IMAGES} images, 10 MB each. Group → Balances → screenshot.</p>
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

          {step === "review" && (
            <section className="pt-4 space-y-6">
              <div className="rise">
                <h1 className="text-[clamp(28px,6vw,38px)] font-semibold tracking-[-0.04em] leading-tight">Check your balances</h1>
                <p className="mt-2 text-muted">Fix anything that looks wrong. Fields we weren't sure about are highlighted. Nothing is saved until you confirm.</p>
              </div>
              <ImageNotes images={images} warnings={warnings} />
              {groups.map((g, gi) => (
                <GroupCard key={g.key} g={g} check={checks[gi]} spaces={spaces} onChange={(fn) => update(gi, fn)} />
              ))}
              <Button variant="secondary" onClick={() => setGroups((gs) => [...gs, emptyGroup()])}>+ Add another group manually</Button>
            </section>
          )}
        </div>
      </main>

      {step === "review" && (
        <div className="fixed bottom-0 inset-x-0 bg-surface/95 backdrop-blur border-t border-line pb-[env(safe-area-inset-bottom)]">
          <div className="mx-auto max-w-[720px] px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <p className="flex-1 text-[13px] text-muted">
              {included.length} {included.length === 1 ? "group" : "groups"} · {totalTransfers} opening {totalTransfers === 1 ? "balance" : "balances"} · {totalPlaceholders} {totalPlaceholders === 1 ? "person" : "people"} to invite
            </p>
            <Button size="lg" loading={saving} disabled={!ready} onClick={confirm}>Import balances</Button>
          </div>
        </div>
      )}
    </div>
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

function GroupCard({ g, check, spaces, onChange }: { g: ReviewGroup; check: ReturnType<typeof checkGroup>; spaces: OwnedSpace[]; onChange: (fn: (g: ReviewGroup) => ReviewGroup) => void }) {
  const roots = g.people.filter((p) => resolveKey(g.people, p.key) === p.key);
  const name = (key: string) => {
    const p = g.people.find((x) => x.key === key);
    return p?.mapping.kind === "me" ? "you" : p?.name || "Someone";
  };
  const existing = g.target.kind === "existing" ? spaces.find((s) => s.id === (g.target as { spaceId: string }).spaceId) : null;
  const mode = !g.include ? "skip" : g.target.kind;
  const setPerson = (key: string, fn: (p: ReviewPerson) => ReviewPerson) => onChange((x) => ({ ...x, people: x.people.map((p) => (p.key === key ? fn(p) : p)) }));

  return (
    <article className={cx("rounded-[20px] bg-surface ring-1 p-4 sm:p-6 space-y-5 rise", g.include ? "ring-line" : "ring-line opacity-60")}>
      <div className="space-y-3">
        <div role="radiogroup" aria-label="What to do with this group" className="grid grid-cols-3 gap-1 p-1 rounded-[14px] bg-sunken ring-1 ring-line">
          {([["new", "New Space"], ["existing", "Existing Space"], ["skip", "Skip"]] as const).map(([k, label]) => (
            <button key={k} type="button" role="radio" aria-checked={mode === k} disabled={k === "existing" && !spaces.length}
              onClick={() => onChange((x) => k === "skip" ? { ...x, include: false }
                : k === "new" ? { ...x, include: true, target: { kind: "new", name: x.target.kind === "new" ? x.target.name : "", type: "shared_home" } }
                : { ...x, include: true, target: { kind: "existing", spaceId: spaces[0].id }, people: x.people.map((p) => (p.mapping.kind === "existing" ? { ...p, mapping: { kind: "placeholder" } } : p)) })}
              className={cx("h-10 rounded-[10px] text-[14px] transition-all disabled:opacity-40", mode === k ? "bg-surface font-medium shadow-[0_1px_3px_rgba(11,26,24,0.12)]" : "text-ink-2")}>
              {label}
            </button>
          ))}
        </div>
        {g.include && g.target.kind === "new" && (
          <div className="grid sm:grid-cols-[1fr_180px] gap-3">
            <label className="block">
              <span className="block text-[13px] font-medium text-ink-2 mb-1.5">Space name {g.lowConfidenceName && <span className="text-warning">· check this</span>}</span>
              <Input value={g.target.name} maxLength={60} placeholder="Flat 4B" className={cx(g.lowConfidenceName && "ring-2 ring-warning/60")}
                onChange={(e) => onChange((x) => ({ ...x, target: { ...(x.target as { kind: "new"; name: string; type: SpaceType }), name: e.target.value } }))} />
            </label>
            <label className="block">
              <span className="block text-[13px] font-medium text-ink-2 mb-1.5">Type</span>
              <Select value={g.target.type} onChange={(e) => onChange((x) => ({ ...x, target: { ...(x.target as { kind: "new"; name: string; type: SpaceType }), type: e.target.value as SpaceType } }))}>
                {SPACE_TYPES.map((t) => <option key={t} value={t}>{SPACE_PRESETS[t].label}</option>)}
              </Select>
            </label>
          </div>
        )}
        {g.include && g.target.kind === "existing" && (
          <label className="block">
            <span className="block text-[13px] font-medium text-ink-2 mb-1.5">Add to</span>
            <Select value={g.target.spaceId} onChange={(e) => onChange((x) => ({ ...x, target: { kind: "existing", spaceId: e.target.value }, people: x.people.map((p) => (p.mapping.kind === "existing" ? { ...p, mapping: { kind: "placeholder" } } : p)) }))}>
              {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </label>
        )}
      </div>

      {g.include && (
        <>
          <ul className="space-y-3">
            {g.people.map((p) => {
              const merged = p.mapping.kind === "merge";
              const dir = p.netCents === null ? "" : p.netCents > 0 ? "owed" : p.netCents < 0 ? "owes" : "settled";
              return (
                <li key={p.key} className={cx("rounded-[14px] p-3 ring-1", p.lowConfidence ? "ring-warning/50 bg-warning-wash/40" : "ring-line bg-ground/50")}>
                  <div className="flex items-center gap-2">
                    <Input aria-label="Name" value={p.name} maxLength={80} placeholder="Name" className="h-10 flex-1" onChange={(e) => setPerson(p.key, (x) => ({ ...x, name: e.target.value }))} />
                    <button type="button" aria-label={`Remove ${p.name || "person"}`} className="grid place-items-center size-10 rounded-[10px] text-muted hover:bg-sunken"
                      onClick={() => onChange((x) => ({ ...x, people: x.people.filter((y) => y.key !== p.key).map((y) => (y.mapping.kind === "merge" && y.mapping.into === p.key ? { ...y, mapping: { kind: "placeholder" } } : y)) }))}>×</button>
                  </div>
                  <div className="mt-2 grid grid-cols-[1fr_120px] gap-2">
                    <Select aria-label="Balance direction" value={dir} className="h-10" disabled={merged}
                      onChange={(e) => setPerson(p.key, (x) => {
                        const abs = Math.abs(x.netCents ?? 0);
                        const v = e.target.value;
                        return { ...x, netCents: v === "settled" ? 0 : v === "owed" ? abs : v === "owes" ? -abs : null };
                      })}>
                      <option value="" disabled>Choose…</option>
                      <option value="owes">{p.mapping.kind === "me" ? "I owe" : "Owes"}</option>
                      <option value="owed">{p.mapping.kind === "me" ? "I'm owed" : "Is owed"}</option>
                      <option value="settled">Settled up</option>
                    </Select>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true">$</span>
                      <AmountInput cents={p.netCents === null ? null : Math.abs(p.netCents)} disabled={merged || dir === "settled"}
                        onChange={(c) => setPerson(p.key, (x) => ({ ...x, netCents: c === null ? null : (x.netCents ?? -1) < 0 ? -c : c }))} />
                    </div>
                  </div>
                  {p.currency && p.currency !== "USD" && <p className="mt-2 text-[13px] text-error">Shown in {p.currency}. Only US dollars are supported, so this group can't be imported until it's fixed or skipped.</p>}
                  <div className="mt-2">
                    <Select aria-label={`Who is ${p.name || "this person"}?`} className="h-10" value={p.mapping.kind === "merge" ? `merge:${p.mapping.into}` : p.mapping.kind === "existing" ? `existing:${p.mapping.memberId}` : p.mapping.kind}
                      onChange={(e) => {
                        const v = e.target.value;
                        setPerson(p.key, (x) => ({ ...x, mapping: v === "me" ? { kind: "me" } : v === "placeholder" ? { kind: "placeholder" }
                          : v.startsWith("merge:") ? { kind: "merge", into: v.slice(6) } : { kind: "existing", memberId: v.slice(9) } }));
                        if (v === "me") onChange((x) => ({ ...x, people: x.people.map((y) => (y.key !== p.key && y.mapping.kind === "me" ? { ...y, mapping: { kind: "placeholder" } } : y)) }));
                      }}>
                      <option value="me">This is me</option>
                      <option value="placeholder">{g.target.kind === "existing" ? "New person (invite later)" : "Add as member (invite later)"}</option>
                      {roots.filter((r) => r.key !== p.key && resolveKey(g.people, r.key) !== p.key).map((r) => <option key={r.key} value={`merge:${r.key}`}>Same person as {r.name || "…"}</option>)}
                      {existing?.members.filter((m) => !m.isMe).map((m) => <option key={m.id} value={`existing:${m.id}`}>Existing member: {m.name}</option>)}
                    </Select>
                    {merged && <p className="mt-1.5 text-[12px] text-muted">Counted once with {name((p.mapping as { into: string }).into)}. Their balances must match.</p>}
                  </div>
                  {p.lowConfidence && <p className="mt-2 text-[12px] text-warning">We weren't sure we read this correctly. Please check it.</p>}
                </li>
              );
            })}
          </ul>
          <Button size="sm" variant="secondary" onClick={() => onChange((x) => ({ ...x, people: [...x.people, newPerson()] }))}>+ Add person</Button>

          <div className="rounded-[14px] bg-sunken p-4 space-y-2">
            {check.errors.map((e) => <p key={e} className="text-[14px] text-error flex gap-2"><span aria-hidden="true">!</span>{e}</p>)}
            {check.balanced ? (
              <p className="text-[14px] text-success flex gap-2"><span aria-hidden="true">✓</span>Balances net to $0.00</p>
            ) : (
              <div className="space-y-2">
                <p className="text-[14px] text-warning">Balances net to {formatUSD(Math.abs(check.netCents))}{check.netCents > 0 ? " owed" : " owing"}, not $0.00. Some balances may be missing. Add another screenshot or enter them manually.</p>
                <label className="flex items-start gap-2 text-[14px]">
                  <input type="checkbox" className="mt-1 accent-[var(--ink)]" checked={g.acknowledgedImbalance} onChange={(e) => onChange((x) => ({ ...x, acknowledgedImbalance: e.target.checked }))} />
                  <span>Import anyway. Only the part that matches up comes over{check.unmatched.length ? `; ${check.unmatched.map((u) => `${formatUSD(Math.abs(u.cents))} of ${name(u.key)}'s balance`).join(", ")} won't be imported` : ""}.</span>
                </label>
              </div>
            )}
            {check.errors.length === 0 && check.transfers.length > 0 && (
              <div className="pt-2">
                <p className="text-[13px] font-medium text-ink-2 mb-1">What we'll bring over</p>
                <ul className="text-[15px] space-y-1">
                  {check.transfers.map((t) => {
                    const from = name(t.from), to = name(t.to);
                    return <li key={`${t.from}-${t.to}`}>{from === "you" ? "You owe" : `${from} owes`} {to} <strong className="num">{formatUSD(t.cents)}</strong></li>;
                  })}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
    </article>
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
      className="w-full h-10 rounded-[12px] bg-surface ring-1 ring-inset ring-line-strong pl-7 pr-3 text-right num text-[16px] focus:outline-none focus:ring-2 focus:ring-teal disabled:opacity-50" />
  );
}

function GuideArt() {
  return (
    <svg className="mt-8 w-full max-w-[420px]" viewBox="0 0 420 200" role="img" aria-label="A phone showing a group's balances screen, with a screenshot flash">
      <rect x="20" y="10" width="120" height="180" rx="18" fill="var(--surface)" stroke="var(--line-strong)" strokeWidth="2" />
      <rect x="38" y="32" width="60" height="8" rx="4" fill="var(--ink)" />
      <rect x="38" y="48" width="40" height="6" rx="3" fill="var(--line-strong)" />
      {[0, 1, 2, 3].map((i) => (
        <g key={i}>
          <circle cx="46" cy={80 + i * 24} r="7" fill="var(--sunken)" stroke="var(--line-strong)" />
          <rect x="60" y={76 + i * 24} width="40" height="6" rx="3" fill="var(--line-strong)" />
          <rect x="106" y={76 + i * 24} width="18" height="6" rx="3" fill={i % 2 ? "var(--teal)" : "var(--warning)"} opacity=".7" />
        </g>
      ))}
      <path d="M160 100h60" stroke="var(--teal)" strokeWidth="2" strokeDasharray="4 5" />
      <path d="M212 94l8 6-8 6" fill="none" stroke="var(--teal)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="240" y="40" width="160" height="120" rx="18" fill="var(--night)" />
      <text x="258" y="70" fill="#ffffff" opacity=".6" fontSize="11" fontFamily="var(--font-geist)">Opening balances</text>
      <text x="258" y="100" fill="#ffffff" fontSize="15" fontFamily="var(--font-geist)">Rahul owes you</text>
      <text x="258" y="126" fill="#5eead4" fontSize="22" fontFamily="var(--font-serif)">$42.50</text>
    </svg>
  );
}
