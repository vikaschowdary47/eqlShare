/**
 * Splitwise import: pure logic shared by the server and the review screen.
 *
 * An import is only the uploader's own pairwise balances: person × group × amount,
 * signed from the uploader's side (positive = they owe you). Balances between other
 * people are never reconstructed. The model reports what's printed; everything else
 * (merging names, filling gaps, checking totals) happens here, deterministically,
 * and anything worked out rather than read is labelled so the user can check it.
 */
import { z } from "zod";
import type { Cents } from "./money";

export const SCREEN_TYPES = ["friends", "groups", "group_page", "friend_page", "unknown"] as const;
export type ScreenType = (typeof SCREEN_TYPES)[number];
export const LOW_CONFIDENCE = 0.75;

// ---------- model output (one screenshot) ----------
const cents = z.number().int().min(0).max(100_000_000).nullable().catch(null);
const conf = z.number().min(0).max(1).catch(0);
const text = z.string().transform((s) => s.replace(/\s+/g, " ").trim());
const name = text.pipe(z.string().min(1).max(80));
const optionalName = z.string().nullable().catch(null).transform((s) => (s ? s.replace(/\s+/g, " ").trim().slice(0, 80) || null : null));

/** A list where one malformed item is dropped instead of failing the whole screenshot. */
const lenient = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z.array(z.unknown()).catch([]).transform((xs) => xs.slice(0, max).flatMap((x) => { const r = item.safeParse(x); return r.success ? [r.data as z.infer<T>] : []; }));

const imageSchema = z.object({
  screen_type: z.enum(SCREEN_TYPES).catch("unknown"),
  title: optionalName,
  overall: z.object({ direction: z.enum(["you_owe", "you_are_owed", "settled"]), cents, confidence: conf }).nullable().catch(null),
  person_totals: lenient(z.object({ name, direction: z.enum(["owes_you", "you_owe", "settled"]), cents, confidence: conf }), 100),
  group_totals: lenient(z.object({ group: optionalName, non_group: z.boolean().catch(false), direction: z.enum(["you_are_owed", "you_owe", "settled"]), cents, confidence: conf }), 50),
  lines: lenient(z.object({ person: optionalName, group: optionalName, non_group: z.boolean().catch(false), direction: z.enum(["owes_you", "you_owe"]), cents, confidence: conf }), 200),
  hidden: lenient(z.object({ under: text, count: z.number().int().min(1).max(99).catch(1) }), 50),
  warnings: lenient(z.string().max(300), 20),
});
export type ImageExtraction = z.infer<typeof imageSchema>;
export type ParseResult = { ok: true; value: ImageExtraction } | { ok: false; error: string };

/** Validates raw model text. Malformed output is an error for that image, never a guess. */
export function parseImageExtraction(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "The response wasn't valid JSON." };
  }
  const r = imageSchema.safeParse(json);
  if (!r.success) return { ok: false, error: "The response didn't match the expected shape." };
  return { ok: true, value: r.data };
}

// ---------- names ----------
export const normalizeName = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const tokens = (s: string) => normalizeName(s).split(" ").filter(Boolean);
const NON_GROUP = /^(non ?group( expenses)?|no group|not in a group|individual expenses)$/;
const isYou = (s: string) => /^(you|me|myself)$/.test(normalizeName(s));

/**
 * Two names can be the same person when first names match and every later word of the
 * shorter name starts the matching word of the longer one: "Ravi K." ~ "Ravi Kumar",
 * "Divya" ~ "Divya Home". "Ravi K." is not "Ravi Rao".
 */
export function namesCompatible(a: string, b: string): boolean {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length || !tb.length || ta[0] !== tb[0]) return false;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.every((t, i) => long[i].startsWith(t) || t.startsWith(long[i]));
}
/** Fuller name wins: more words, then longer. */
const fuller = (a: string, b: string) => (tokens(b).length - tokens(a).length) || (b.length - a.length);

/** The one existing member a name refers to, or null when there's none or more than one. */
export function matchName<T extends { name: string }>(personName: string, candidates: T[]): T | null {
  const hits = candidates.filter((c) => namesCompatible(personName, c.name));
  return hits.length === 1 ? hits[0] : null;
}

// ---------- merging screenshots ----------
export interface ImageStatus { index: number; ok: boolean; screenType: ScreenType | null; duplicateOf: number | null; error: string | null; warnings: string[] }
/** One balance line as printed. group null = not in a group. cents signed: positive = they owe you. */
export interface LineObs { img: number; screen: ScreenType; person: string; group: string | null; cents: Cents | null; confidence: number }
export interface TotalObs { img: number; screen: ScreenType; name: string | null; cents: Cents | null; confidence: number }
export interface ExtractionResult {
  images: ImageStatus[];
  lines: LineObs[];
  personTotals: TotalObs[];
  /** name null = the "Non-group expenses" row. */
  groupTotals: TotalObs[];
  overall: TotalObs[];
  hidden: { img: number; under: string; count: number }[];
  warnings: string[];
}

const signed = (direction: string, c: Cents | null) => (c === null ? null : direction === "you_owe" ? -c : direction === "settled" ? 0 : c);
const groupOrNull = (g: string | null, nonGroup: boolean) => (nonGroup || !g || NON_GROUP.test(normalizeName(g)) ? null : g);

/** Content fingerprint used to spot the same screen captured twice. */
export function fingerprint(e: ImageExtraction): string {
  return JSON.stringify([e.screen_type, e.title && normalizeName(e.title), e.lines.map((l) => [l.person && normalizeName(l.person), l.group && normalizeName(l.group), l.direction, l.cents]).sort(),
    e.person_totals.map((t) => [normalizeName(t.name), t.direction, t.cents]).sort()]);
}

export function mergeExtractions(images: { index: number; byteHash: string; parsed: ParseResult }[]): ExtractionResult {
  const out: ExtractionResult = { images: [], lines: [], personTotals: [], groupTotals: [], overall: [], hidden: [], warnings: [] };
  const seenBytes = new Map<string, number>(), seenContent = new Map<string, number>();
  for (const img of images) {
    const st: ImageStatus = { index: img.index, ok: img.parsed.ok, screenType: null, duplicateOf: null, error: null, warnings: [] };
    out.images.push(st);
    if (!img.parsed.ok) { st.error = img.parsed.error; continue; }
    const e = img.parsed.value;
    st.screenType = e.screen_type;
    st.warnings = [...e.warnings];
    if (e.screen_type === "unknown") st.warnings.push("This doesn't look like Splitwise's Friends or Groups tab.");
    const fp = fingerprint(e);
    const dup = seenBytes.get(img.byteHash) ?? (e.lines.length || e.person_totals.length ? seenContent.get(fp) : undefined);
    if (dup !== undefined) { st.duplicateOf = dup; continue; }
    seenBytes.set(img.byteHash, img.index);
    seenContent.set(fp, img.index);

    const s = e.screen_type, i = img.index;
    if (e.overall) out.overall.push({ img: i, screen: s, name: null, cents: signed(e.overall.direction, e.overall.cents), confidence: e.overall.confidence });
    for (const t of e.person_totals) if (!isYou(t.name)) out.personTotals.push({ img: i, screen: s, name: t.name, cents: signed(t.direction, t.cents), confidence: t.confidence });
    for (const t of e.group_totals) out.groupTotals.push({ img: i, screen: s, name: groupOrNull(t.group, t.non_group), cents: signed(t.direction, t.cents), confidence: t.confidence });
    for (const l of e.lines) {
      // On a single friend's or group's page the title fills whichever side the line leaves out
      const person = l.person ?? (s === "friend_page" ? e.title : null);
      const group = l.non_group ? null : l.group ?? (s === "group_page" ? e.title : null);
      if (!person || isYou(person)) continue;
      out.lines.push({ img: i, screen: s, person, group: groupOrNull(group, l.non_group), cents: signed(l.direction, l.cents), confidence: l.confidence });
    }
    for (const h of e.hidden) out.hidden.push({ img: i, under: h.under, count: h.count });
  }
  if (out.images.some((x) => x.duplicateOf !== null)) out.warnings.push("Some screenshots were duplicates and were skipped.");
  return out;
}

// ---------- review state ----------
export interface ReviewPerson { key: string; name: string; manual?: boolean; removed?: boolean }
export interface AutoMerge { alias: string; into: string }
export interface ReviewState {
  people: ReviewPerson[];
  /** normalized raw name -> person key */
  alias: Record<string, string>;
  /** raw spelling for each alias, for "Merged: Ravi K. = Ravi Kumar" */
  aliasLabel: Record<string, string>;
  merges: AutoMerge[];
  /** Names that could be more than one person, so they weren't merged */
  ambiguous: { personKey: string; candidates: string[] }[];
  groups: { key: string; name: string }[];
  groupAlias: Record<string, string>;
  /** `${personKey}|${groupKey}` -> cents (signed) or null for removed. groupKey "" = not in a group. */
  edits: Record<string, Cents | null>;
  seq: number;
}
export const NO_GROUP = "";
export const lineKey = (personKey: string, groupKey: string) => `${personKey}|${groupKey}`;

export function buildReview(x: ExtractionResult): ReviewState {
  const state: ReviewState = { people: [], alias: {}, aliasLabel: {}, merges: [], ambiguous: [], groups: [], groupAlias: {}, edits: {}, seq: 0 };

  // People: cluster spellings, fullest first, merging only when exactly one person fits
  const spellings = new Map<string, string>();
  for (const n of [...x.personTotals.map((t) => t.name!), ...x.lines.map((l) => l.person)]) {
    const k = normalizeName(n);
    if (!k) continue;
    if (!spellings.has(k) || fuller(spellings.get(k)!, n) > 0) spellings.set(k, n);
  }
  const clusters: { key: string; names: string[] }[] = [];
  for (const [norm, raw] of [...spellings].sort((a, b) => fuller(a[1], b[1]))) {
    const fits = clusters.filter((c) => c.names.every((n) => namesCompatible(n, raw)));
    state.aliasLabel[norm] = raw;
    if (fits.length === 1) {
      fits[0].names.push(raw);
      state.alias[norm] = fits[0].key;
      state.merges.push({ alias: norm, into: fits[0].key });
    } else {
      const key = `p${++state.seq}`;
      clusters.push({ key, names: [raw] });
      state.alias[norm] = key;
      state.people.push({ key, name: raw });
      if (fits.length > 1) state.ambiguous.push({ personKey: key, candidates: fits.map((c) => c.names[0]) });
    }
  }

  // Groups: same name, or a truncated name ("12 elm st…") that fits exactly one group
  const gSpell = new Map<string, string>();
  for (const n of [...x.lines.map((l) => l.group), ...x.groupTotals.map((t) => t.name)]) {
    if (!n) continue;
    const k = normalizeName(n);
    if (k && (!gSpell.has(k) || n.length > gSpell.get(k)!.length)) gSpell.set(k, n);
  }
  const truncated = (s: string) => /(…|\.\.\.)\s*$/.test(s);
  for (const [norm, raw] of [...gSpell].sort((a, b) => b[1].length - a[1].length)) {
    if (truncated(raw)) {
      const fits = state.groups.filter((g) => normalizeName(g.name).startsWith(norm));
      if (fits.length === 1) { state.groupAlias[norm] = fits[0].key; continue; }
    }
    const key = `g${++state.seq}`;
    state.groups.push({ key, name: raw.slice(0, 60) });
    state.groupAlias[norm] = key;
  }
  return state;
}

export const personOf = (s: ReviewState, raw: string) => s.alias[normalizeName(raw)];
export const groupOf = (s: ReviewState, raw: string | null) => (raw === null ? NO_GROUP : s.groupAlias[normalizeName(raw)] ?? NO_GROUP);

/** Undo an automatic merge: that spelling becomes its own person again. */
export function undoMerge(s: ReviewState, alias: string): ReviewState {
  const key = `p${s.seq + 1}`;
  return {
    ...s, seq: s.seq + 1,
    people: [...s.people, { key, name: s.aliasLabel[alias] ?? alias }],
    alias: { ...s.alias, [alias]: key },
    merges: s.merges.filter((m) => m.alias !== alias),
  };
}

/** The user says two people are the same: every spelling and edit of `from` moves to `into`. */
export function mergePeople(s: ReviewState, from: string, into: string): ReviewState {
  if (from === into) return s;
  const alias = Object.fromEntries(Object.entries(s.alias).map(([k, v]) => [k, v === from ? into : v]));
  const edits: Record<string, Cents | null> = {};
  for (const [k, v] of Object.entries(s.edits)) {
    const [p, g] = k.split("|");
    const nk = lineKey(p === from ? into : p, g);
    if (!(nk in edits) || p === into) edits[nk] = v;
  }
  return { ...s, alias, edits, people: s.people.filter((p) => p.key !== from), ambiguous: s.ambiguous.filter((a) => a.personKey !== from) };
}

export function addPerson(s: ReviewState, name: string): { state: ReviewState; key: string } {
  const key = `p${s.seq + 1}`;
  return { state: { ...s, seq: s.seq + 1, people: [...s.people, { key, name: name.trim(), manual: true }] }, key };
}

export function addGroup(s: ReviewState, name: string): { state: ReviewState; key: string } {
  const existing = s.groupAlias[normalizeName(name)];
  if (existing) return { state: s, key: existing };
  const key = `g${s.seq + 1}`;
  return { state: { ...s, seq: s.seq + 1, groups: [...s.groups, { key, name: name.trim().slice(0, 60) }], groupAlias: { ...s.groupAlias, [normalizeName(name)]: key } }, key };
}

// ---------- deriving what will be imported ----------
export type LineSource = "read" | "worked_out" | "edited";
export interface DerivedLine {
  groupKey: string;
  groupName: string;
  cents: Cents | null;
  source: LineSource;
  /** A different amount for the same line on another screenshot */
  otherReading: Cents | null;
  lowConfidence: boolean;
}
export interface DerivedPerson {
  key: string;
  name: string;
  lines: DerivedLine[];
  totalCents: Cents;
  /** Splitwise's total for this person, when a screenshot showed it */
  splitwiseTotal: Cents | null;
  /** splitwiseTotal minus what we have; non-zero means something's missing */
  gapCents: Cents;
  merged: { alias: string; label: string }[];
  maybeSameAs: string[];
}
export interface DerivedSpace { key: string; name: string; pair: boolean; groupKey: string | null; people: { key: string; name: string; cents: Cents }[] }
export interface Derived {
  people: DerivedPerson[];
  overall: { splitwise: Cents | null; splitwiseDisagrees: boolean; ours: Cents; matches: boolean | null; offBy: Cents };
  spaces: DerivedSpace[];
  /** Must be fixed before importing */
  blocking: string[];
}

const RANK: Record<ScreenType, number> = { friends: 0, friend_page: 1, groups: 2, group_page: 2, unknown: 3 };
const pickTotal = (obs: TotalObs[]) => [...obs].sort((a, b) => RANK[a.screen] - RANK[b.screen])[0];

export function derive(s: ReviewState, x: ExtractionResult): Derived {
  const groupName = (k: string) => (k === NO_GROUP ? "Not in a group" : s.groups.find((g) => g.key === k)?.name ?? "Unknown group");
  const live = new Set(s.people.filter((p) => !p.removed).map((p) => p.key));

  // 1. Lines as read: the best screen wins; a different reading elsewhere is kept for the user to see
  const read = new Map<string, { cents: Cents | null; rank: number; other: Cents | null; conf: number }>();
  for (const l of x.lines) {
    const k = lineKey(personOf(s, l.person), groupOf(s, l.group));
    const cur = read.get(k), rank = RANK[l.screen];
    if (!cur) { read.set(k, { cents: l.cents, rank, other: null, conf: l.confidence }); continue; }
    const better = rank < cur.rank || (cur.cents === null && l.cents !== null);
    const [keep, drop] = better ? [{ cents: l.cents, rank, conf: l.confidence }, cur.cents] : [cur, l.cents];
    read.set(k, { cents: keep.cents, rank: keep.rank, conf: Math.min(cur.conf, l.confidence), other: drop !== null && drop !== keep.cents ? drop : cur.other });
  }
  const lines = new Map<string, DerivedLine>();
  for (const [k, r] of read) {
    const g = k.slice(k.indexOf("|") + 1);
    lines.set(k, { groupKey: g, groupName: groupName(g), cents: r.cents, source: "read", otherReading: r.other, lowConfidence: r.cents === null || r.conf < LOW_CONFIDENCE || r.other !== null });
  }

  // 2. Totals Splitwise showed
  const personTotal = new Map<string, Cents>();
  for (const [p, obs] of groupBy(x.personTotals.filter((t) => t.cents !== null), (t) => personOf(s, t.name!))) personTotal.set(p, pickTotal(obs).cents!);
  const groupTotal = new Map<string, Cents>();
  for (const [g, obs] of groupBy(x.groupTotals.filter((t) => t.cents !== null), (t) => groupOf(s, t.name))) groupTotal.set(g, pickTotal(obs).cents!);

  // 3. Fill a gap only when exactly one person and one group explain it, and label it
  const sumBy = (pick: (k: string) => string) => {
    const m = new Map<string, Cents>();
    for (const [k, l] of lines) if (l.cents !== null) m.set(pick(k), (m.get(pick(k)) ?? 0) + l.cents);
    return m;
  };
  for (let changed = true; changed;) {
    changed = false;
    const byPerson = sumBy((k) => k.split("|")[0]), byGroup = sumBy((k) => k.slice(k.indexOf("|") + 1));
    const pGaps = [...personTotal].map(([p, t]) => ({ p, gap: t - (byPerson.get(p) ?? 0) })).filter((g) => g.gap !== 0);
    const gGaps = [...groupTotal].map(([g, t]) => ({ g, gap: t - (byGroup.get(g) ?? 0) })).filter((g) => g.gap !== 0);
    for (const pg of pGaps) {
      const fits = gGaps.filter((gg) => gg.gap === pg.gap && !lines.has(lineKey(pg.p, gg.g)));
      if (fits.length !== 1) continue;
      const g = fits[0].g;
      if (pGaps.filter((o) => o.gap === pg.gap && !lines.has(lineKey(o.p, g))).length !== 1) continue;
      lines.set(lineKey(pg.p, g), { groupKey: g, groupName: groupName(g), cents: pg.gap, source: "worked_out", otherReading: null, lowConfidence: false });
      changed = true;
      break;
    }
  }

  // 4. The user's edits win
  for (const [k, v] of Object.entries(s.edits)) {
    if (v === null) { lines.delete(k); continue; }
    const g = k.slice(k.indexOf("|") + 1);
    lines.set(k, { groupKey: g, groupName: groupName(g), cents: v, source: "edited", otherReading: null, lowConfidence: false });
  }

  // 5. People
  const people: DerivedPerson[] = s.people.filter((p) => live.has(p.key)).map((p) => {
    // Settled lines are dropped, except one the user just added and hasn't filled in yet
    const mine = [...lines].filter(([k, l]) => k.split("|")[0] === p.key && (l.cents !== 0 || l.source === "edited")).map(([, l]) => l)
      .sort((a, b) => Math.abs(b.cents ?? 0) - Math.abs(a.cents ?? 0) || a.groupName.localeCompare(b.groupName));
    const total = mine.reduce((a, l) => a + (l.cents ?? 0), 0);
    const sw = personTotal.get(p.key) ?? null;
    return {
      key: p.key, name: p.name, lines: mine, totalCents: total, splitwiseTotal: sw, gapCents: sw === null ? 0 : sw - total,
      merged: s.merges.filter((m) => m.into === p.key).map((m) => ({ alias: m.alias, label: s.aliasLabel[m.alias] ?? m.alias })),
      maybeSameAs: s.ambiguous.find((a) => a.personKey === p.key)?.candidates ?? [],
    };
  }).filter((p) => p.lines.length || p.splitwiseTotal || s.people.find((q) => q.key === p.key)?.manual)
    .sort((a, b) => a.name.localeCompare(b.name));

  // 6. Overall check against Splitwise's own total
  const ours = people.reduce((a, p) => a + p.totalCents, 0);
  const overallObs = x.overall.filter((o) => o.cents !== null);
  const sw = overallObs.length ? pickTotal(overallObs).cents! : null;
  const overall = { splitwise: sw, splitwiseDisagrees: new Set(overallObs.map((o) => o.cents)).size > 1, ours, matches: sw === null ? null : sw === ours, offBy: sw === null ? 0 : sw - ours };

  // 7. Spaces: one per group, and one 2-person Space per person for balances outside groups
  const spaces: DerivedSpace[] = [];
  for (const g of s.groups) {
    const ppl = people.flatMap((p) => p.lines.filter((l) => l.groupKey === g.key && l.cents).map((l) => ({ key: p.key, name: p.name, cents: l.cents! })));
    if (ppl.length) spaces.push({ key: `g:${g.key}`, name: g.name, pair: false, groupKey: g.key, people: ppl });
  }
  const solo = people.flatMap((p) => p.lines.filter((l) => l.groupKey === NO_GROUP && l.cents).map((l) => ({ key: p.key, name: p.name, cents: l.cents! })));
  const first = (n: string) => n.split(" ")[0];
  for (const p of solo) {
    const clash = solo.filter((o) => first(o.name).toLowerCase() === first(p.name).toLowerCase()).length > 1;
    spaces.push({ key: `p:${p.key}`, name: `You & ${clash ? p.name : first(p.name)}`.slice(0, 60), pair: true, groupKey: null, people: [p] });
  }

  const blocking: string[] = [];
  for (const p of people) {
    if (!p.name.trim()) blocking.push("Every person needs a name.");
    if (p.lines.some((l) => l.cents === null || l.cents === 0)) blocking.push(`Add the amount for ${p.name}.`);
  }
  if (!spaces.length) blocking.push("There are no balances to import.");
  return { people, overall, spaces, blocking };
}

function groupBy<T>(xs: T[], key: (x: T) => string) {
  const m = new Map<string, T[]>();
  for (const x of xs) { const k = key(x); m.set(k, [...(m.get(k) ?? []), x]); }
  return m;
}

// ---------- double counting ----------
/** One of the viewer's existing Spaces and their running balance with each member. */
export interface ExistingSpace { id: string; name: string; activeCount: number; members: { id: string; name: string; netWithMeCents: Cents }[] }
export interface DuplicateMatch { spaceKey: string; personKey: string; personName: string; importCents: Cents; existing: { spaceId: string; spaceName: string; memberName: string; cents: Cents } }

/**
 * A balance probably already exists when the viewer shares a matching Space with a member
 * who is this person: same Space name for a group, or a 2-person Space for a direct balance.
 */
export function findDuplicates(spaces: DerivedSpace[], existing: ExistingSpace[]): DuplicateMatch[] {
  const out: DuplicateMatch[] = [];
  for (const sp of spaces) {
    const candidates = existing.filter((e) => (sp.pair ? e.activeCount === 2 : normalizeName(e.name) === normalizeName(sp.name)));
    for (const p of sp.people) {
      const hits = candidates.flatMap((e) => { const m = matchName(p.name, e.members); return m ? [{ e, m }] : []; });
      if (hits.length !== 1) continue;
      const { e, m } = hits[0];
      out.push({ spaceKey: sp.key, personKey: p.key, personName: p.name, importCents: p.cents, existing: { spaceId: e.id, spaceName: e.name, memberName: m.name, cents: m.netWithMeCents } });
    }
  }
  return out;
}

// ---------- building the import ----------
export type SpaceType = "shared_home" | "couple" | "family" | "group";
export type SpaceTarget = { kind: "new"; name: string; type: SpaceType } | { kind: "existing"; spaceId: string };
export interface SpaceChoice { target: SpaceTarget; include: boolean }
export const defaultChoice = (sp: DerivedSpace): SpaceChoice => ({ include: true, target: { kind: "new", name: sp.name, type: sp.pair ? "group" : "shared_home" } });

/** Builds the payload for apply_splitwise_import. Throws with a plain message if something isn't ready. */
export function buildImportPlan(
  d: Derived,
  choices: Record<string, SpaceChoice>,
  opts: { imageCount: number; skip?: Set<string>; existingMembers?: Record<string, { id: string; name: string }[]> },
) {
  if (d.blocking.length) throw new Error(d.blocking[0]);
  const used = new Set<string>();
  const spaces = d.spaces.flatMap((sp) => {
    const c = choices[sp.key] ?? defaultChoice(sp);
    if (!c.include) return [];
    const balances = sp.people.filter((p) => !opts.skip?.has(`${sp.key}|${p.key}`)).map((p) => {
      used.add(p.key);
      const member = c.target.kind === "existing" ? matchName(p.name, opts.existingMembers?.[c.target.spaceId] ?? []) : null;
      return { person_key: p.key, cents: p.cents, ...(member ? { member_id: member.id } : {}) };
    });
    if (!balances.length) return [];
    if (c.target.kind === "new" && !c.target.name.trim()) throw new Error("Every Space needs a name.");
    const target = c.target.kind === "new" ? { kind: "new", name: c.target.name.trim().slice(0, 60), type: c.target.type } : { kind: "existing", space_id: c.target.spaceId };
    return [{ target, balances }];
  });
  if (!spaces.length) throw new Error("Choose at least one balance to import.");
  return {
    image_count: opts.imageCount,
    people: d.people.filter((p) => used.has(p.key)).map((p) => ({ key: p.key, display_name: p.name.trim().slice(0, 80) })),
    spaces,
  };
}
