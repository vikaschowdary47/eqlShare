/**
 * Live check against the real Gemini API. Skipped unless GEMINI_LIVE=1, so the normal
 * suite never spends money or needs network. Run:
 *   GEMINI_LIVE=1 node --env-file=.env node_modules/.bin/vitest run tests/gemini.live.test.ts
 * The fixture is a synthetic screen with made-up names, plus a planted instruction.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { extractBalancesFromImages } from "@/lib/import/extract";
import { checkGroup, toReviewGroups } from "@/lib/domain/import";

describe.skipIf(!process.env.GEMINI_LIVE)("Gemini live extraction", () => {
  it("reads the synthetic balances screen and ignores instructions inside it", async () => {
    const bytes = new Uint8Array(readFileSync("tests/fixtures/balances-flat4b.png"));
    const { result, usage } = await extractBalancesFromImages([{ bytes, mimeType: "image/png" }]);
    expect(result.images[0].ok).toBe(true);
    expect(result.images[0].screenType).toBe("group_balances");
    const g = result.groups[0];
    const nets = Object.fromEntries(g.people.map((p) => [p.name, p.netCents]));
    expect(nets).toMatchObject({ "Rahul Kumar": -4775, Asha: -475, Dev: 0 });
    expect(Object.values(nets)).not.toContain(100000000);
    const review = toReviewGroups(result)[0];
    expect(review.people.find((p) => p.mapping.kind === "me")?.name).toBe("You");
    expect(checkGroup(review).balanced).toBe(true);
    console.log(`live usage: ${usage.inputTokens} in / ${usage.outputTokens} out, ${usage.latencyMs} ms`);
  }, 60_000);
});
