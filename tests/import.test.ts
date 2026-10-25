import { describe, expect, it } from "vitest";
import {
  buildImportPlan, buildReview, defaultChoice, derive, findDuplicates, matchName, mergeExtractions, mergePeople, namesCompatible,
  parseImageExtraction, undoMerge, lineKey, NO_GROUP, type ExtractionResult, type ImageExtraction,
} from "@/lib/domain/import";

/**
 * A made-up account shaped like real Splitwise Friends + Groups tabs:
 * abbreviated names on one tab, a person with no lines on Friends, a "Plus 2 more"
 * that hides one balance, and a Non-group expenses row. Overall: you owe $372.30.
 */
const friends: ImageExtraction = {
  screen_type: "friends", title: null,
  overall: { direction: "you_owe", cents: 37230, confidence: 0.99 },
  person_totals: [
    { name: "Arjun", direction: "owes_you", cents: 4100, confidence: 0.98 },
    { name: "Divya Home", direction: "you_owe", cents: 5000, confidence: 0.98 },
    { name: "Kiran Lakshmi UNH", direction: "owes_you", cents: 2500, confidence: 0.98 },
    { name: "Meena", direction: "owes_you", cents: 1230, confidence: 0.98 },
    { name: "Ravi Kumar", direction: "you_owe", cents: 40060, confidence: 0.98 },
  ],
  group_totals: [],
  lines: [
    { person: "Arjun", group: "Lakeview", non_group: false, direction: "owes_you", cents: 6100, confidence: 0.97 },
    { person: "Arjun", group: null, non_group: true, direction: "you_owe", cents: 3000, confidence: 0.97 },
    { person: "Arjun", group: "12 elm street", non_group: false, direction: "owes_you", cents: 1000, confidence: 0.97 },
    { person: "Divya H.", group: "12 elm street", non_group: false, direction: "you_owe", cents: 3000, confidence: 0.97 },
    { person: "Divya H.", group: "Lakeview", non_group: false, direction: "you_owe", cents: 2000, confidence: 0.97 },
    { person: "Ravi K.", group: "Flat(301)", non_group: false, direction: "you_owe", cents: 39000, confidence: 0.97 },
    { person: "Ravi K.", group: null, non_group: true, direction: "you_owe", cents: 1060, confidence: 0.97 },
  ],
  hidden: [], warnings: [],
};
const groups: ImageExtraction = {
  screen_type: "groups", title: null,
  overall: { direction: "you_owe", cents: 37230, confidence: 0.99 },
  person_totals: [],
  group_totals: [
    { group: "12 elm street", non_group: false, direction: "you_owe", cents: 770, confidence: 0.98 },
    { group: "Flat(301)", non_group: false, direction: "you_owe", cents: 39000, confidence: 0.98 },
    { group: "Lakeview", non_group: false, direction: "you_are_owed", cents: 6600, confidence: 0.98 },
    { group: "Non-group expenses", non_group: false, direction: "you_owe", cents: 4060, confidence: 0.98 },
  ],
  lines: [
    { person: "Divya H.", group: "12 elm street", non_group: false, direction: "you_owe", cents: 3000, confidence: 0.97 },
    { person: "Ravi K.", group: "Flat(301)", non_group: false, direction: "you_owe", cents: 39000, confidence: 0.97 },
    { person: "Arjun", group: "Lakeview", non_group: false, direction: "owes_you", cents: 6100, confidence: 0.97 },
    { person: "Kiran L.", group: "Lakeview", non_group: false, direction: "owes_you", cents: 2500, confidence: 0.97 },
    { person: "Arjun", group: "Non-group expenses", non_group: true, direction: "you_owe", cents: 3000, confidence: 0.97 },
    { person: "Ravi K.", group: "Non-group expenses", non_group: true, direction: "you_owe", cents: 1060, confidence: 0.97 },
  ],
  hidden: [{ under: "12 elm street", count: 2 }, { under: "Lakeview", count: 2 }],
  warnings: [],
};
const merged = (imgs: ImageExtraction[]): ExtractionResult =>
  mergeExtractions(imgs.map((e, i) => ({ index: i, byteHash: `h${i}`, parsed: { ok: true as const, value: e } })));

function setup() {
  const x = merged([friends, groups]);
  const s = buildReview(x);
  return { x, s, d: derive(s, x) };
}
const linesOf = (d: ReturnType<typeof derive>, name: string) =>
  d.people.find((p) => p.name === name)!.lines.map((l) => `${l.groupName} ${l.cents}${l.source === "worked_out" ? " (worked out)" : ""}`).sort();

describe("names", () => {
  it("matches abbreviations and first names, not different surnames", () => {
    expect(namesCompatible("Ravi K.", "Ravi Kumar")).toBe(true);
    expect(namesCompatible("Kiran L.", "Kiran Lakshmi UNH")).toBe(true);
    expect(namesCompatible("Ravi", "Ravi Kumar")).toBe(true);
    expect(namesCompatible("Ravi R.", "Ravi Kumar")).toBe(false);
    expect(namesCompatible("Ravina", "Ravi Kumar")).toBe(false);
  });
  it("only matches when exactly one candidate fits", () => {
    expect(matchName("Ravi", [{ name: "Ravi Kumar" }, { name: "Ravi Rao" }])).toBeNull();
    expect(matchName("Ravi K.", [{ name: "Ravi Kumar" }, { name: "Ravi Rao" }])?.name).toBe("Ravi Kumar");
  });
});

describe("reading Friends + Groups screenshots", () => {
  it("finds each person once, under the fuller name, with exact lines", () => {
    const { d } = setup();
    expect(d.people.map((p) => p.name)).toEqual(["Arjun", "Divya Home", "Kiran Lakshmi UNH", "Meena", "Ravi Kumar"]);
    expect(linesOf(d, "Arjun")).toEqual(["12 elm street 1000", "Lakeview 6100", "Not in a group -3000"]);
    expect(linesOf(d, "Divya Home")).toEqual(["12 elm street -3000", "Lakeview -2000"]);
    expect(linesOf(d, "Kiran Lakshmi UNH")).toEqual(["Lakeview 2500"]); // only on the Groups tab
    expect(linesOf(d, "Ravi Kumar")).toEqual(["Flat(301) -39000", "Not in a group -1060"]);
  });

  it("works out a hidden balance from the totals and labels it", () => {
    const { d } = setup();
    // Meena has no lines anywhere; 12 elm street's total leaves exactly her amount unexplained
    expect(linesOf(d, "Meena")).toEqual(["12 elm street 1230 (worked out)"]);
  });

  it("matches Splitwise's overall total and never nets a group to zero", () => {
    const { d } = setup();
    expect(d.overall).toMatchObject({ splitwise: -37230, ours: -37230, matches: true, offBy: 0 });
    expect(d.people.every((p) => p.gapCents === 0)).toBe(true);
    expect(d.blocking).toEqual([]);
  });

  it("makes one Space per group and a 2-person Space per direct balance", () => {
    const { d } = setup();
    expect(d.spaces.map((s) => `${s.name}: ${s.people.map((p) => p.name).sort().join(", ")}`).sort()).toEqual([
      "12 elm street: Arjun, Divya Home, Meena",
      "Flat(301): Ravi Kumar",
      "Lakeview: Arjun, Divya Home, Kiran Lakshmi UNH",
      "You & Arjun: Arjun",
      "You & Ravi: Ravi Kumar",
    ]);
    expect(d.spaces.filter((s) => s.pair).every((s) => s.people.length === 1)).toBe(true);
  });

  it("never treats the Non-group expenses row or 'You' as a group or person", () => {
    const { s, d } = setup();
    expect(s.groups.map((g) => g.name)).not.toContain("Non-group expenses");
    expect(d.people.map((p) => p.name)).not.toContain("You");
  });

  it("shows what was merged and can undo it", () => {
    const { x, s, d } = setup();
    expect(d.people.find((p) => p.name === "Ravi Kumar")!.merged.map((m) => m.label)).toEqual(["Ravi K."]);
    const alias = s.merges.find((m) => s.aliasLabel[m.alias] === "Ravi K.")!.alias;
    const d2 = derive(undoMerge(s, alias), x);
    expect(linesOf(d2, "Ravi K.")).toEqual(["Flat(301) -39000", "Not in a group -1060"]);
    // Splitwise's total for Ravi Kumar is now unexplained, and the review says so
    expect(d2.people.find((p) => p.name === "Ravi Kumar")).toMatchObject({ lines: [], gapCents: -40060 });
  });

  it("doesn't merge a name that could be two people", () => {
    const x = merged([{ ...friends, person_totals: [], lines: [
      { person: "Ravi Kumar", group: "A", non_group: false, direction: "owes_you", cents: 100, confidence: 1 },
      { person: "Ravi Rao", group: "A", non_group: false, direction: "owes_you", cents: 200, confidence: 1 },
      { person: "Ravi", group: "B", non_group: false, direction: "owes_you", cents: 300, confidence: 1 },
    ], overall: null }]);
    const s = buildReview(x);
    const d = derive(s, x);
    expect(d.people.map((p) => p.name).sort()).toEqual(["Ravi", "Ravi Kumar", "Ravi Rao"]);
    expect(d.people.find((p) => p.name === "Ravi")!.maybeSameAs.sort()).toEqual(["Ravi Kumar", "Ravi Rao"]);
    const into = s.people.find((p) => p.name === "Ravi Kumar")!.key, from = s.people.find((p) => p.name === "Ravi")!.key;
    expect(linesOf(derive(mergePeople(s, from, into), x), "Ravi Kumar")).toEqual(["A 100", "B 300"]);
  });

  it("reports a gap instead of inventing a group when the totals don't single one out", () => {
    const x = merged([{ ...friends, lines: friends.lines }, { ...groups, group_totals: [] }]);
    const d = derive(buildReview(x), x);
    expect(d.people.find((p) => p.name === "Meena")).toMatchObject({ lines: [], splitwiseTotal: 1230, gapCents: 1230 });
    expect(d.overall).toMatchObject({ matches: false, offBy: 1230 });
  });

  it("keeps the Friends reading when tabs disagree, and flags it", () => {
    const g2 = { ...groups, lines: groups.lines.map((l) => (l.person === "Ravi K." && l.group === "Flat(301)" ? { ...l, cents: 38000 } : l)) };
    const x = merged([friends, g2]);
    const line = derive(buildReview(x), x).people.find((p) => p.name === "Ravi Kumar")!.lines.find((l) => l.groupName === "Flat(301)")!;
    expect(line).toMatchObject({ cents: -39000, otherReading: -38000, lowConfidence: true });
  });

  it("applies edits, including adding and removing lines", () => {
    const { x, s } = setup();
    const ravi = s.people.find((p) => p.name === "Ravi Kumar")!.key;
    const d = derive({ ...s, edits: { [lineKey(ravi, NO_GROUP)]: null } }, x);
    expect(linesOf(d, "Ravi Kumar")).toEqual(["Flat(301) -39000"]);
    expect(d.overall.offBy).toBe(-1060);
  });

  it("skips duplicate screenshots", () => {
    const x = mergeExtractions([0, 1].map((i) => ({ index: i, byteHash: "same", parsed: { ok: true as const, value: friends } })));
    expect(x.images[1].duplicateOf).toBe(0);
  });

  it("rejects malformed model output", () => {
    expect(parseImageExtraction("not json").ok).toBe(false);
    expect(parseImageExtraction(JSON.stringify({ screen_type: "friends" })).ok).toBe(true); // empty but valid
  });
});

describe("double counting", () => {
  it("finds a balance that already exists between the same two people", () => {
    const { d } = setup();
    const dups = findDuplicates(d.spaces, [
      { id: "s1", name: "Flat(301)", activeCount: 3, members: [{ id: "m1", name: "Ravi Kumar", netWithMeCents: -39000 }] },
      { id: "s2", name: "You & Arjun", activeCount: 2, members: [{ id: "m2", name: "Arjun S", netWithMeCents: -3000 }] },
      { id: "s3", name: "Elsewhere", activeCount: 4, members: [{ id: "m3", name: "Divya Home", netWithMeCents: 100 }] },
    ]);
    expect(dups.map((m) => `${m.personName}@${m.existing.spaceName}:${m.existing.cents}`).sort()).toEqual(["Arjun@You & Arjun:-3000", "Ravi Kumar@Flat(301):-39000"]);
  });
});

describe("import plan", () => {
  it("contains only the uploader's own balances, signed", () => {
    const { d } = setup();
    const choices = Object.fromEntries(d.spaces.map((s) => [s.key, defaultChoice(s)]));
    const plan = buildImportPlan(d, choices, { imageCount: 2 });
    expect(plan.people).toHaveLength(5);
    expect(plan.spaces).toHaveLength(5);
    const total = plan.spaces.flatMap((s) => s.balances).reduce((a, b) => a + b.cents, 0);
    expect(total).toBe(-37230);
    expect(plan.spaces.find((s) => s.target.kind === "new" && "name" in s.target && s.target.name === "You & Ravi")!.target).toMatchObject({ type: "group" });
  });

  it("skips balances confirmed as already imported, and attaches to existing members by name", () => {
    const { d } = setup();
    const flat = d.spaces.find((s) => s.name === "Flat(301)")!;
    const ravi = flat.people[0].key;
    const choices = Object.fromEntries(d.spaces.map((s) => [s.key, defaultChoice(s)]));
    const skipped = buildImportPlan(d, choices, { imageCount: 2, skip: new Set([`${flat.key}|${ravi}`]) });
    expect(skipped.spaces).toHaveLength(4);
    choices[flat.key] = { include: true, target: { kind: "existing", spaceId: "S" } };
    const attached = buildImportPlan(d, choices, { imageCount: 2, existingMembers: { S: [{ id: "m9", name: "Ravi Kumar" }] } });
    expect(attached.spaces.find((s) => s.target.kind === "existing")!.balances[0]).toMatchObject({ member_id: "m9", cents: -39000 });
  });
});

describe("model output tolerance", () => {
  it("drops one malformed row instead of the whole screenshot", () => {
    const r = parseImageExtraction(JSON.stringify({ ...friends, person_totals: [...friends.person_totals, { name: "", direction: "owes_you", cents: 5, confidence: 1 }, "junk"] }));
    expect(r.ok && r.value.person_totals.length).toBe(5);
  });
});
