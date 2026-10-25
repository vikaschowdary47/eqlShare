import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@google/genai", () => ({ GoogleGenAI: class { constructor() { throw new Error("network must not be used in tests"); } } }));

import { extractBalancesFromImages, sniffImageType, type Generate } from "@/lib/import/extract";
import {
  buildImportPlan, checkGroup, parseImageExtraction, simplifyDebts, toReviewGroups, type ReviewGroup,
} from "@/lib/domain/import";

const PNG = (seed: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, seed]);
const img = (seed: number) => ({ bytes: PNG(seed), mimeType: "image/png" });

const flat = (members: [string, number | null, boolean?][], extra: Partial<{ screen_type: string; currency: string; groupName: string }> = {}) => JSON.stringify({
  screen_type: extra.screen_type ?? "group_balances",
  groups: [{
    name: extra.groupName ?? "Flat 4B", confidence: 0.95,
    members: members.map(([name, net, me]) => ({ name, is_current_user_guess: !!me, net_balance_cents: net, currency: extra.currency ?? "USD", confidence: net === null ? 0.2 : 0.95 })),
    debts: [],
  }],
  warnings: [],
});

const mock = (texts: string[]): Generate => {
  let i = 0;
  return async () => ({ text: texts[i++], inputTokens: 1000, outputTokens: 200 });
};

describe("extraction module (Gemini mocked)", () => {
  it("parses valid JSON into groups", async () => {
    const { result, usage } = await extractBalancesFromImages([img(1)], { generate: mock([flat([["You", 5250, true], ["Rahul Kumar", -4775], ["Asha", -475]])]) });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].people.map((p) => p.netCents)).toEqual([5250, -4775, -475]);
    expect(usage.inputTokens).toBe(1000);
    expect(result.images[0]).toMatchObject({ ok: true, screenType: "group_balances", duplicateOf: null });
  });

  it("marks malformed JSON as a failed image without throwing", async () => {
    const { result } = await extractBalancesFromImages([img(1), img(2)], { generate: mock(["{not json", flat([["You", 0, true]])]) });
    expect(result.images[0].ok).toBe(false);
    expect(result.images[1].ok).toBe(true);
  });

  it("rejects the wrong shape and provider errors", async () => {
    expect(parseImageExtraction(JSON.stringify({ groups: "nope" })).ok).toBe(false);
    const failing: Generate = async () => { throw new Error("429"); };
    const { result } = await extractBalancesFromImages([img(1)], { generate: failing });
    expect(result.images[0].ok).toBe(false);
  });

  it("keeps unreadable values null and low confidence", async () => {
    const { result } = await extractBalancesFromImages([img(1)], { generate: mock([flat([["You", 1000, true], ["Rahul", null]])]) });
    const review = toReviewGroups(result)[0];
    const rahul = review.people.find((p) => p.name === "Rahul")!;
    expect(rahul.netCents).toBeNull();
    expect(rahul.lowConfidence).toBe(true);
    expect(checkGroup(review).errors).toContain("Add Rahul's balance, or skip them.");
  });

  it("flags and blocks non-USD amounts", async () => {
    const { result } = await extractBalancesFromImages([img(1)], { generate: mock([flat([["You", 1000, true], ["Rahul", -1000]], { currency: "EUR" })]) });
    const errors = checkGroup(toReviewGroups(result)[0]).errors;
    expect(errors.some((e) => e.includes("EUR"))).toBe(true);
    expect(() => buildImportPlan(toReviewGroups(result), 1)).toThrow(/EUR/);
  });

  it("skips duplicate screenshots by bytes and by content", async () => {
    const same = flat([["You", 500, true], ["Rahul", -500]]);
    const r1 = await extractBalancesFromImages([img(1), img(1)], { generate: mock([same, same]) });
    expect(r1.result.images[1].duplicateOf).toBe(0);
    const r2 = await extractBalancesFromImages([img(1), img(2)], { generate: mock([same, same]) });
    expect(r2.result.images[1].duplicateOf).toBe(0);
    expect(r2.result.groups[0].people).toHaveLength(2);
  });

  it("merges two screenshots of the same group", async () => {
    const top = flat([["You", 5250, true], ["Rahul Kumar", -4775]]);
    const bottom = flat([["Rahul  Kumar", -4775], ["Asha", -475]], { groupName: "flat 4b" });
    const { result } = await extractBalancesFromImages([img(1), img(2)], { generate: mock([top, bottom]) });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].people.map((p) => p.name)).toEqual(["You", "Rahul Kumar", "Asha"]);
    expect(result.groups[0].sourceImages).toEqual([0, 1]);
    const c = checkGroup(toReviewGroups(result)[0]);
    expect(c.balanced).toBe(true);
    expect(c.errors).toEqual([]);
  });

  it("flags conflicting balances for the same person", async () => {
    const a = flat([["You", 100, true], ["Rahul", -100]]);
    const b = flat([["Rahul", -200], ["Asha", 100]]);
    const { result } = await extractBalancesFromImages([img(1), img(2)], { generate: mock([a, b]) });
    expect(result.groups[0].people.find((p) => p.name === "Rahul")!.conflict).toBe(true);
  });

  it("warns when the screenshot isn't the Balances screen", async () => {
    const { result } = await extractBalancesFromImages([img(1)], { generate: mock([flat([["You", 0, true]], { screen_type: "group_main" })]) });
    expect(result.images[0].warnings.join(" ")).toMatch(/Balances/);
  });

  it("sniffs image types from bytes", () => {
    expect(sniffImageType(PNG(0))).toBe("image/png");
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageType(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
  });
});

describe("debt simplification", () => {
  const sum = (ts: { from: string; to: string; cents: number }[], key: string) =>
    ts.reduce((a, t) => a + (t.to === key ? t.cents : 0) - (t.from === key ? t.cents : 0), 0);

  it("reproduces a 3-person group exactly", () => {
    const nets = [{ key: "me", cents: 5250 }, { key: "rahul", cents: -4775 }, { key: "asha", cents: -475 }];
    const { transfers, unmatched } = simplifyDebts(nets);
    expect(unmatched).toEqual([]);
    for (const n of nets) expect(sum(transfers, n.key)).toBe(n.cents);
    expect(transfers.length).toBeLessThanOrEqual(2);
  });

  it("sums exactly for many random groups of 3 to 8 people", () => {
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let t = 0; t < 500; t++) {
      const n = 3 + Math.floor(rnd() * 6);
      const vals = Array.from({ length: n - 1 }, () => Math.floor(rnd() * 200001) - 100000);
      vals.push(-vals.reduce((a, v) => a + v, 0));
      const nets = vals.map((cents, i) => ({ key: `p${i}`, cents }));
      const { transfers, unmatched } = simplifyDebts(nets);
      expect(unmatched).toEqual([]);
      expect(transfers.length).toBeLessThanOrEqual(n - 1);
      for (const x of transfers) expect(Number.isSafeInteger(x.cents) && x.cents > 0).toBe(true);
      for (const nn of nets) expect(sum(transfers, nn.key)).toBe(nn.cents);
    }
  });

  it("never invents money when balances don't net to zero", () => {
    const { transfers, unmatched } = simplifyDebts([{ key: "me", cents: 1000 }, { key: "rahul", cents: -400 }]);
    expect(transfers).toEqual([{ from: "rahul", to: "me", cents: 400 }]);
    expect(unmatched).toEqual([{ key: "me", cents: 600 }]);
  });
});

describe("review and import plan", () => {
  const group = (): ReviewGroup => ({
    key: "g0", include: true, target: { kind: "new", name: "Flat 4B", type: "shared_home" }, lowConfidenceName: false, sourceImages: [0], acknowledgedImbalance: false,
    people: [
      { key: "a", name: "You", netCents: 5250, currency: "USD", lowConfidence: false, mapping: { kind: "placeholder" } },
      { key: "b", name: "Rahul Kumar", netCents: -4775, currency: "USD", lowConfidence: false, mapping: { kind: "placeholder" } },
      { key: "c", name: "Rahul K", netCents: -4775, currency: "USD", lowConfidence: false, mapping: { kind: "merge", into: "b" } },
      { key: "d", name: "Asha", netCents: -475, currency: "USD", lowConfidence: false, mapping: { kind: "placeholder" } },
    ],
  });

  it("blocks import until someone is mapped to me", () => {
    expect(() => buildImportPlan([group()], 1)).toThrow(/you/);
  });

  it("merged people count once and the plan nets to zero", () => {
    const g = group();
    g.people[0].mapping = { kind: "me" };
    const c = checkGroup(g);
    expect(c.errors).toEqual([]);
    expect(c.balanced).toBe(true);
    const plan = buildImportPlan([g], 1);
    expect(plan.groups[0].people.map((p) => p.key)).toEqual(["a", "b", "d"]);
    const total = plan.groups[0].debts.reduce((a, d) => a + d.amount_cents, 0);
    expect(total).toBe(5250);
  });

  it("merged people with different balances must be fixed", () => {
    const g = group();
    g.people[0].mapping = { kind: "me" };
    g.people[2].netCents = -4000;
    expect(checkGroup(g).errors.join(" ")).toMatch(/two different balances/);
  });

  it("an imbalance needs explicit acknowledgment", () => {
    const g = group();
    g.people[0].mapping = { kind: "me" };
    g.people[3].netCents = null;
    g.people.pop();
    expect(checkGroup(g).balanced).toBe(false);
    expect(() => buildImportPlan([g], 1)).toThrow(/balance warning/);
    g.acknowledgedImbalance = true;
    const plan = buildImportPlan([g], 1);
    expect(plan.groups[0].debts).toEqual([{ from_key: "b", to_key: "a", amount_cents: 4775, source_image_index: 0 }]);
  });
});
