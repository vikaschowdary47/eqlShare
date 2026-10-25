import { describe, expect, it } from "vitest";
import { statementFromVision, statementKey } from "@/lib/domain/statement";

const good = {
  is_bill: true, provider: "City Power & Light", provider_confidence: 0.95, amount_due_cents: 8420, amount_due_confidence: 0.9,
  due_date: "2026-11-15", due_date_confidence: 0.9, period_start: "2026-10-01", period_end: "2026-10-31", account_last4: "4321", statement_number: null,
};

describe("statementFromVision", () => {
  it("keeps confident fields and always asks a person to check", () => {
    const e = statementFromVision(good);
    expect(e.provider).toEqual({ value: "City Power & Light", status: "found" });
    expect(e.amountDueCents).toEqual({ value: 8420, status: "found" });
    expect(e.dueDate.value).toBe("2026-11-15");
    expect(e.needsReview).toBe(true);
    expect(e.parserVersion).toBe("vision-1");
    expect(statementKey(e)).toBe("City Power & Light|4321|2026-10-01|2026-10-31");
  });
  it("drops low-confidence values instead of trusting them", () => {
    const e = statementFromVision({ ...good, amount_due_confidence: 0.4 });
    expect(e.amountDueCents).toEqual({ value: null, status: "ambiguous" });
    expect(e.reasons).toContain("Amount due was hard to read");
  });
  it("rejects malformed values", () => {
    const e = statementFromVision({ ...good, amount_due_cents: -5, due_date: "2026-02-30", account_last4: "12ab", period_start: "Oct 1" });
    expect(e.amountDueCents.status).toBe("missing");
    expect(e.dueDate.status).toBe("missing");
    expect(e.accountLast4).toBeNull();
    expect(e.periodStart).toBeNull();
  });
  it("handles garbage and non-bills", () => {
    expect(statementFromVision(null).provider.status).toBe("missing");
    expect(statementFromVision({ ...good, is_bill: false }).kind).toBe("notice_only");
  });
});
