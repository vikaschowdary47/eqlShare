import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { extractBalancesFromImages } from "@/lib/import/extract";

const reply = JSON.stringify({ screen_type: "friends", title: null, overall: null, person_totals: [], group_totals: [], warnings: [], hidden: [],
  lines: [{ person: "Alex", group: "Lakeview", non_group: false, direction: "owes_you", cents: 500, confidence: 0.9 }] });

describe("extractBalancesFromImages", () => {
  it("retries a screenshot when the reply is unusable", async () => {
    const generate = vi.fn().mockResolvedValueOnce({ text: "not json", inputTokens: 1, outputTokens: 1 }).mockResolvedValueOnce({ text: reply, inputTokens: 1, outputTokens: 1 });
    const { result } = await extractBalancesFromImages([{ bytes: new Uint8Array([1]), mimeType: "image/png" }], { generate, retryDelayMs: 0 });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(result.images[0].ok).toBe(true);
    expect(result.lines).toHaveLength(1);
  });

  it("rides out a busy provider, then gives up after 3 attempts", async () => {
    const busy = Object.assign(new Error("503 high demand"), { status: 503 });
    const flaky = vi.fn().mockRejectedValueOnce(busy).mockRejectedValueOnce(busy).mockResolvedValueOnce({ text: reply, inputTokens: 1, outputTokens: 1 });
    expect((await extractBalancesFromImages([{ bytes: new Uint8Array([3]), mimeType: "image/png" }], { generate: flaky, retryDelayMs: 0 })).result.images[0].ok).toBe(true);
    const generate = vi.fn().mockRejectedValue(busy);
    const { result } = await extractBalancesFromImages([{ bytes: new Uint8Array([2]), mimeType: "image/png" }], { generate, retryDelayMs: 0 });
    expect(generate).toHaveBeenCalledTimes(3);
    expect(result.images[0]).toMatchObject({ ok: false });
  });
});

describe("extractStatementFromImage", () => {
  it("retries a busy provider", async () => {
    const { extractStatementFromImage } = await import("@/lib/import/extract");
    const generate = vi.fn().mockRejectedValueOnce(new Error("503")).mockResolvedValueOnce({ text: '{"amount_due_cents":8420}', inputTokens: 1, outputTokens: 1 });
    const { fields } = await extractStatementFromImage({ bytes: new Uint8Array([1]), mimeType: "image/png" }, { generate, retryDelayMs: 0 });
    expect(fields).toEqual({ amount_due_cents: 8420 });
  });
});
