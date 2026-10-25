/**
 * Splitwise import: pure logic shared by the server and the review screen.
 * Nothing here talks to a model or the database. Values are never invented:
 * anything unreadable stays null and is marked low confidence for review.
 */
import { z } from "zod";
import type { Cents } from "./money";

export const SCREEN_TYPES = ["group_balances", "group_main", "friend_page", "unknown"] as const;
export type ScreenType = (typeof SCREEN_TYPES)[number];
export const LOW_CONFIDENCE = 0.75;

// ---------- model output (one screenshot) ----------
const cents = z.number().int().nullable();
const conf = z.number().min(0).max(1).catch(0);
const name = z.string().transform((s) => s.replace(/\s+/g, " ").trim()).pipe(z.string().min(1).max(80));
const currency = z.string().nullable().transform((c) => (c ? c.trim().toUpperCase() : null));

const imageSchema = z.object({
  screen_type: z.enum(SCREEN_TYPES).catch("unknown"),
  groups: z.array(z.object({
    name: z.string().nullable().transform((s) => (s ? s.replace(/\s+/g, " ").trim() || null : null)),
    confidence: conf,
    members: z.array(z.object({
      name,
      is_current_user_guess: z.boolean().catch(false),
      net_balance_cents: cents,
      currency,
      confidence: conf,
    })).max(50),
    debts: z.array(z.object({
      from_name: name,
      to_name: name,
      amount_cents: cents.refine((v) => v === null || v > 0, "debt must be positive"),
      currency,
      confidence: conf,
    })).max(100),
  })).max(20),
  warnings: z.array(z.string().max(300)).max(20).catch([]),
});
export type ImageExtraction = z.infer<typeof imageSchema>;

export type ParseResult = { ok: true; value: ImageExtraction } | { ok: false; error: string };

/** Validates raw model text. Malformed output is an error for that image, never a guess. */
export function parseImageExtraction(text: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: "The response wasn't valid JSON." };
  }
  const r = imageSchema.safeParse(json);
  if (!r.success) return { ok: false, error: "The response didn't match the expected shape." };
  return { ok: true, value: r.data };
}

// ---------- merging screenshots ----------
export interface DetectedPerson {
  name: string;
  isMeGuess: boolean;
  netCents: Cents | null;
  currency: string | null;
  confidence: number;
  sourceImages: number[];
  conflict: boolean;
}
export interface DetectedDebt { from: string; to: string; amountCents: Cents | null; currency: string | null; confidence: number; sourceImage: number }
export interface DetectedGroup {
  name: string;
  confidence: number;
  people: DetectedPerson[];
  debts: DetectedDebt[];
  sourceImages: number[];
}
export interface ImageStatus {
  index: number;
  ok: boolean;
  screenType: ScreenType | null;
  duplicateOf: number | null;
  error: string | null;
  warnings: string[];
}
export interface ExtractionResult {
  images: ImageStatus[];
  groups: DetectedGroup[];
  warnings: string[];
}

export const normalizeName = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Content fingerprint used to spot the same screen captured twice. */
export function fingerprint(e: ImageExtraction): string {
  return JSON.stringify(e.groups.map((g) => [
    normalizeName(g.name ?? ""),
    g.members.map((m) => [normalizeName(m.name), m.net_balance_cents]).sort(),
    g.debts.map((d) => [normalizeName(d.from_name), normalizeName(d.to_name), d.amount_cents]).sort(),
  ]));
}

/**
 * Merge per-image results. Images are matched to groups by normalized group name;
 * people by normalized name. Conflicting balances for the same person are kept as
 * the first value and flagged for review.
 */
export function mergeExtractions(images: { index: number; byteHash: string; parsed: ParseResult }[]): ExtractionResult {
  const statuses: ImageStatus[] = [];
  const groups = new Map<string, DetectedGroup>();
  const warnings: string[] = [];
  const seenBytes = new Map<string, number>();
  const seenContent = new Map<string, number>();

  for (const img of images) {
    const st: ImageStatus = { index: img.index, ok: img.parsed.ok, screenType: null, duplicateOf: null, error: null, warnings: [] };
    statuses.push(st);
    if (!img.parsed.ok) { st.error = img.parsed.error; continue; }
    const e = img.parsed.value;
    st.screenType = e.screen_type;
    st.warnings = e.warnings;
    if (e.screen_type !== "group_balances")
      st.warnings = [...st.warnings, e.screen_type === "unknown" ? "This doesn't look like a Splitwise group's Balances screen." : "This isn't the group's Balances screen, so some balances may be missing. Open the group, tap Balances, and screenshot that."];

    const dupBytes = seenBytes.get(img.byteHash);
    const fp = fingerprint(e);
    const dupContent = e.groups.length ? seenContent.get(fp) : undefined;
    if (dupBytes !== undefined || dupContent !== undefined) { st.duplicateOf = dupBytes ?? dupContent!; continue; }
    seenBytes.set(img.byteHash, img.index);
    if (e.groups.length) seenContent.set(fp, img.index);

    for (const g of e.groups) {
      const key = normalizeName(g.name ?? "") || `untitled-${img.index}`;
      let group = groups.get(key);
      if (!group) {
        group = { name: g.name ?? "Untitled group", confidence: g.confidence, people: [], debts: [], sourceImages: [] };
        groups.set(key, group);
      }
      group.confidence = Math.min(group.confidence, g.confidence);
      if (!group.sourceImages.includes(img.index)) group.sourceImages.push(img.index);

      for (const m of g.members) {
        const existing = group.people.find((p) => normalizeName(p.name) === normalizeName(m.name));
        if (!existing) {
          group.people.push({ name: m.name, isMeGuess: m.is_current_user_guess, netCents: m.net_balance_cents, currency: m.currency, confidence: m.confidence, sourceImages: [img.index], conflict: false });
        } else {
          existing.sourceImages.push(img.index);
          existing.isMeGuess ||= m.is_current_user_guess;
          if (existing.netCents === null) { existing.netCents = m.net_balance_cents; existing.currency ??= m.currency; }
          else if (m.net_balance_cents !== null && m.net_balance_cents !== existing.netCents) {
            existing.conflict = true;
            existing.confidence = 0;
          }
          existing.confidence = Math.min(existing.confidence, m.confidence);
        }
      }
      for (const d of g.debts) {
        const same = group.debts.find((x) => normalizeName(x.from) === normalizeName(d.from_name) && normalizeName(x.to) === normalizeName(d.to_name) && x.amountCents === d.amount_cents);
        if (!same) group.debts.push({ from: d.from_name, to: d.to_name, amountCents: d.amount_cents, currency: d.currency, confidence: d.confidence, sourceImage: img.index });
        for (const n of [d.from_name, d.to_name])
          if (!group.people.some((p) => normalizeName(p.name) === normalizeName(n)))
            group.people.push({ name: n, isMeGuess: false, netCents: null, currency: d.currency, confidence: d.confidence, sourceImages: [img.index], conflict: false });
      }
    }
  }

  // People with no readable net get one from explicit debts when every debt involving them is readable.
  for (const g of groups.values()) {
    const derived = netsFromDebts(g.debts);
    for (const p of g.people) {
      if (p.netCents !== null) continue;
      const involved = g.debts.filter((d) => normalizeName(d.from) === normalizeName(p.name) || normalizeName(d.to) === normalizeName(p.name));
      if (involved.length && involved.every((d) => d.amountCents !== null)) {
        p.netCents = derived.get(normalizeName(p.name)) ?? null;
        p.confidence = Math.min(p.confidence, ...involved.map((d) => d.confidence));
      }
    }
  }
  if (statuses.some((s) => s.duplicateOf !== null)) warnings.push("Some screenshots were duplicates and were skipped.");
  return { images: statuses, groups: [...groups.values()], warnings };
}

/** Net per normalized name from explicit debts: positive = is owed. Unreadable debts are ignored. */
export function netsFromDebts(debts: Pick<DetectedDebt, "from" | "to" | "amountCents">[]): Map<string, Cents> {
  const net = new Map<string, Cents>();
  for (const d of debts) {
    if (d.amountCents === null) continue;
    const f = normalizeName(d.from), t = normalizeName(d.to);
    net.set(f, (net.get(f) ?? 0) - d.amountCents);
    net.set(t, (net.get(t) ?? 0) + d.amountCents);
  }
  return net;
}

// ---------- simplification ----------
export interface Transfer { from: string; to: string; cents: Cents }

/**
 * Greedy settlement: repeatedly match the largest debtor with the largest creditor.
 * Produces at most n-1 transfers that reproduce every net balance exactly when the
 * nets sum to zero. When they don't (screenshots missing), only the matched part is
 * returned and `unmatched` reports what was left out, so nothing is invented.
 */
export function simplifyDebts(nets: { key: string; cents: Cents }[]): { transfers: Transfer[]; unmatched: { key: string; cents: Cents }[] } {
  for (const n of nets) if (!Number.isSafeInteger(n.cents)) throw new Error("Balances must be whole cents");
  const debtors = nets.filter((n) => n.cents < 0).map((n) => ({ key: n.key, left: -n.cents }));
  const creditors = nets.filter((n) => n.cents > 0).map((n) => ({ key: n.key, left: n.cents }));
  const order = <T extends { key: string; left: number }>(a: T, b: T) => b.left - a.left || a.key.localeCompare(b.key);
  const transfers: Transfer[] = [];
  for (;;) {
    debtors.sort(order);
    creditors.sort(order);
    const d = debtors[0], c = creditors[0];
    if (!d || !c || d.left === 0 || c.left === 0) break;
    const amt = Math.min(d.left, c.left);
    transfers.push({ from: d.key, to: c.key, cents: amt });
    d.left -= amt;
    c.left -= amt;
    if (d.left === 0) debtors.shift();
    if (c.left === 0) creditors.shift();
  }
  const unmatched = [...debtors.filter((d) => d.left > 0).map((d) => ({ key: d.key, cents: -d.left })), ...creditors.filter((c) => c.left > 0).map((c) => ({ key: c.key, cents: c.left }))];
  return { transfers, unmatched };
}

// ---------- review model (also used for manual entry) ----------
export type PersonMapping =
  | { kind: "me" }
  | { kind: "placeholder" }
  | { kind: "merge"; into: string }
  | { kind: "existing"; memberId: string };

export interface ReviewPerson {
  key: string;
  name: string;
  /** Positive: the group owes them. Negative: they owe the group. Null: unknown. */
  netCents: Cents | null;
  currency: string | null;
  lowConfidence: boolean;
  mapping: PersonMapping;
}
export interface ReviewGroup {
  key: string;
  include: boolean;
  target: { kind: "new"; name: string; type: "shared_home" | "couple" | "family" | "group" } | { kind: "existing"; spaceId: string };
  people: ReviewPerson[];
  lowConfidenceName: boolean;
  sourceImages: number[];
  acknowledgedImbalance: boolean;
}

export function toReviewGroups(result: ExtractionResult): ReviewGroup[] {
  return result.groups.map((g, gi) => {
    const people: ReviewPerson[] = g.people.map((p, pi) => ({
      key: `g${gi}p${pi}`,
      name: p.name,
      netCents: p.netCents,
      currency: p.currency,
      lowConfidence: p.conflict || p.netCents === null || p.confidence < LOW_CONFIDENCE,
      mapping: { kind: "placeholder" },
    }));
    // Pre-select "me" only when exactly one person was guessed; the user must still confirm
    const guesses = g.people.map((p, i) => (p.isMeGuess ? i : -1)).filter((i) => i >= 0);
    if (guesses.length === 1) people[guesses[0]].mapping = { kind: "me" };
    return {
      key: `g${gi}`, include: true, target: { kind: "new", name: g.name.slice(0, 60), type: "shared_home" },
      people, lowConfidenceName: g.confidence < LOW_CONFIDENCE, sourceImages: g.sourceImages, acknowledgedImbalance: false,
    };
  });
}

/** Resolve merges: returns the effective person key for each person. */
export function resolveKey(people: ReviewPerson[], key: string): string {
  const seen = new Set<string>();
  let k = key;
  for (;;) {
    const p = people.find((x) => x.key === k);
    if (!p || p.mapping.kind !== "merge" || seen.has(k)) return k;
    seen.add(k);
    k = p.mapping.into;
  }
}

export interface GroupCheck {
  errors: string[];
  netCents: Cents;
  balanced: boolean;
  transfers: Transfer[];
  unmatched: { key: string; cents: Cents }[];
  meKey: string | null;
}

/**
 * Everything the review screen and the import need for one group.
 * Merged people are the same person seen twice, so their balances must agree, not add up.
 */
export function checkGroup(g: ReviewGroup): GroupCheck {
  const errors: string[] = [];
  const roots = g.people.filter((p) => resolveKey(g.people, p.key) === p.key);
  const me = roots.filter((p) => p.mapping.kind === "me");
  if (me.length !== 1) errors.push(me.length === 0 ? "Choose which person is you." : "Only one person can be you.");
  const byRoot = new Map<string, Cents | null>();
  for (const p of g.people) {
    if (p.currency && p.currency !== "USD") errors.push(`${p.name}'s balance is in ${p.currency}. Only US dollars are supported.`);
    const root = resolveKey(g.people, p.key);
    const prev = byRoot.get(root);
    if (prev === undefined || prev === null) byRoot.set(root, p.netCents);
    else if (p.netCents !== null && p.netCents !== prev) errors.push(`${p.name} has two different balances. Edit one so they match.`);
  }
  for (const p of roots) {
    if (byRoot.get(p.key) === null) errors.push(`Add ${p.name}'s balance, or skip them.`);
    if (p.mapping.kind === "placeholder" && !p.name.trim()) errors.push("Every person needs a name.");
  }
  const nets = roots.map((p) => ({ key: p.key, cents: byRoot.get(p.key) ?? 0 }));
  const total = nets.reduce((a, n) => a + n.cents, 0);
  const { transfers, unmatched } = simplifyDebts(nets);
  return { errors, netCents: total, balanced: total === 0, transfers, unmatched, meKey: me[0]?.key ?? null };
}

/** Builds the payload for apply_splitwise_import. Throws if any group isn't ready. */
export function buildImportPlan(groups: ReviewGroup[], imageCount: number) {
  const out = groups.filter((g) => g.include).map((g) => {
    const c = checkGroup(g);
    if (c.errors.length) throw new Error(c.errors[0]);
    if (!c.balanced && !g.acknowledgedImbalance) throw new Error("Confirm the balance warning first.");
    const roots = g.people.filter((p) => resolveKey(g.people, p.key) === p.key);
    const firstImage = g.sourceImages[0];
    return {
      target: g.target.kind === "new" ? { kind: "new", name: g.target.name.trim(), type: g.target.type } : { kind: "existing", space_id: g.target.spaceId },
      people: roots.map((p) =>
        p.mapping.kind === "me" ? { key: p.key, kind: "me" }
        : p.mapping.kind === "existing" ? { key: p.key, kind: "existing", member_id: p.mapping.memberId }
        : { key: p.key, kind: "placeholder", display_name: p.name.trim() }),
      debts: c.transfers.map((t) => ({ from_key: t.from, to_key: t.to, amount_cents: t.cents, ...(firstImage !== undefined ? { source_image_index: firstImage } : {}) })),
    };
  });
  if (!out.length) throw new Error("Choose at least one group to import.");
  return { image_count: imageCount, groups: out };
}
