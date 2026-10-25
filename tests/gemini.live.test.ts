/**
 * Live check against the real Gemini API. Skipped unless GEMINI_LIVE=1, so the normal
 * suite never spends money or needs network. Run:
 *   GEMINI_LIVE=1 node --env-file=.env node_modules/.bin/vitest run tests/gemini.live.test.ts
 * Fixtures are synthetic Splitwise-style screens with made-up names, plus a planted instruction.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { extractBalancesFromImages, extractStatementFromImage } from "@/lib/import/extract";
import { statementFromVision } from "@/lib/domain/statement";
import { buildReview, derive } from "@/lib/domain/import";

describe.skipIf(!process.env.GEMINI_LIVE)("Gemini live extraction", () => {
  it("reads Friends + Groups screenshots into exact pairwise balances and ignores instructions", async () => {
    const imgs = ["splitwise-friends", "splitwise-groups"].map((f) => ({ bytes: new Uint8Array(readFileSync(`tests/fixtures/${f}.png`)), mimeType: "image/png" }));
    const { result, usage } = await extractBalancesFromImages(imgs);
    expect(result.images.map((i) => i.screenType)).toEqual(["friends", "groups"]);
    const d = derive(buildReview(result), result);
    const got = Object.fromEntries(d.people.map((p) => [p.name, p.lines.map((l) => `${l.groupName} ${l.cents}${l.source === "worked_out" ? " (worked out)" : ""}`).sort()]));
    expect(got).toEqual({
      "Arjun": ["12 elm street 1000", "Lakeview 6100", "Not in a group -3000"],
      "Divya Home": ["12 elm street -3000", "Lakeview -2000"],
      "Kiran Lakshmi UNH": ["Lakeview 2500"],
      "Meena": ["12 elm street 1230 (worked out)"],
      "Ravi Kumar": ["Flat(301) -39000", "Not in a group -1060"],
    });
    expect(d.overall).toMatchObject({ splitwise: -37230, ours: -37230, matches: true });
    expect(d.spaces.map((s) => s.name).sort()).toEqual(["12 elm street", "Flat(301)", "Lakeview", "You & Arjun", "You & Ravi"]);
    console.log(`live usage: ${usage.inputTokens} in / ${usage.outputTokens} out, ${usage.latencyMs} ms`);
  }, 120_000);

  it("reads a synthetic bill photo and ignores the planted instruction", async () => {
    const bytes = new Uint8Array(readFileSync("tests/fixtures/bill-citypower.png"));
    const { fields, usage } = await extractStatementFromImage({ bytes, mimeType: "image/png" });
    const e = statementFromVision(fields);
    expect(e.amountDueCents.value).toBe(8420);
    expect(e.dueDate.value).toBe("2026-11-15");
    expect(e.periodStart).toBe("2026-10-01");
    expect(e.periodEnd).toBe("2026-10-31");
    expect(e.accountLast4).toBe("4321");
    expect(e.provider.value).toMatch(/City Power/);
    console.log(`live usage: ${usage.inputTokens} in / ${usage.outputTokens} out, ${usage.latencyMs} ms`);
  }, 60_000);
});
