import { describe, expect, it } from "vitest";
import { parseDollars, formatUSD } from "@/lib/domain/money";
import { splitBill, percentToBps } from "@/lib/domain/split";
import { memberTotals, splitPosition, reportableCents, type SplitLike } from "@/lib/domain/balances";
import { dueState } from "@/lib/domain/due";
import { extractStatement, statementKey, toISODate } from "@/lib/domain/statement";

const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ memberId: `m${i}` }));
const amounts = (r: ReturnType<typeof splitBill>) => (r.ok ? r.shares.map((s) => s.amountCents) : r.error);

describe("money", () => {
  it("parses dollars to cents without floats", () => {
    expect(parseDollars("137.01")).toBe(13701);
    expect(parseDollars("$1,200")).toBe(120000);
    expect(parseDollars("0.5")).toBe(50);
    expect(parseDollars("0.10")).toBe(10);
    expect(parseDollars("1.005")).toBeNull();
    expect(parseDollars("-5")).toBeNull();
    expect(parseDollars("abc")).toBeNull();
  });
  it("formats USD with two decimals", () => {
    expect(formatUSD(5000)).toBe("$50.00");
    expect(formatUSD(123456)).toBe("$1,234.56");
  });
});

describe("splitBill", () => {
  it("$200.00 / 4", () => expect(amounts(splitBill(20000, "equal", ids(4)))).toEqual([5000, 5000, 5000, 5000]));
  it("$100.00 / 3 is deterministic", () => expect(amounts(splitBill(10000, "equal", ids(3)))).toEqual([3334, 3333, 3333]));
  it("$137.01 / 3", () => expect(amounts(splitBill(13701, "equal", ids(3)))).toEqual([4567, 4567, 4567]));
  it("rejects zero and negative totals", () => {
    expect(splitBill(0, "equal", ids(2)).ok).toBe(false);
    expect(splitBill(-100, "equal", ids(2)).ok).toBe(false);
  });
  it("rejects non-integer cents", () => expect(() => splitBill(10.5, "equal", ids(2))).toThrow());
  it("blocks exact splits that do not sum", () => {
    const r = splitBill(13701, "exact", [{ memberId: "a", value: 5000 }, { memberId: "b", value: 6000 }, { memberId: "c", value: 2700 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.differenceCents).toBe(1);
  });
  it("accepts exact splits that sum", () => {
    expect(splitBill(13701, "exact", [{ memberId: "a", value: 5000 }, { memberId: "b", value: 6001 }, { memberId: "c", value: 2700 }]).ok).toBe(true);
  });
  it("percent splits always reconcile", () => {
    const r = splitBill(10001, "percent", [{ memberId: "a", value: 3333 }, { memberId: "b", value: 3333 }, { memberId: "c", value: 3334 }]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.shares.reduce((a, s) => a + s.amountCents, 0)).toBe(10001);
  });
  it("percent must total 100%", () => expect(splitBill(10000, "percent", [{ memberId: "a", value: 5000 }, { memberId: "b", value: 4000 }]).ok).toBe(false));
  it("percent reconciles across many random cases", () => {
    for (let t = 1; t < 3000; t += 37) {
      const r = splitBill(t, "percent", [{ memberId: "a", value: 1 }, { memberId: "b", value: 4999 }, { memberId: "c", value: 5000 }]);
      expect(r.ok && r.shares.reduce((a, s) => a + s.amountCents, 0)).toBe(t);
    }
  });
  it("rejects duplicate members", () => expect(splitBill(100, "equal", [{ memberId: "a" }, { memberId: "a" }]).ok).toBe(false));
  it("parses percentages to basis points", () => {
    expect(percentToBps("33.33")).toBe(3333);
    expect(percentToBps("100")).toBe(10000);
    expect(percentToBps("101")).toBeNull();
  });
});

describe("balances", () => {
  const split = (over: Partial<SplitLike>): SplitLike => ({ id: "s", memberId: "b", payerMemberId: "a", amountCents: 5000, settlements: [], ...over });
  it("payer's own share is never a debt to themselves", () => {
    const totals = memberTotals([split({ memberId: "a" })], "a");
    expect(totals).toEqual({ youOwe: 0, owedToYou: 0, youOwePending: 0, owedToYouPending: 0 });
  });
  it("reported is not confirmed", () => {
    const p = splitPosition(split({ settlements: [{ amountCents: 5000, status: "reported" }] }));
    expect(p.outstandingCents).toBe(5000);
    expect(p.pendingCents).toBe(5000);
  });
  it("confirmed reduces outstanding, partial payments supported", () => {
    const p = splitPosition(split({ settlements: [{ amountCents: 2000, status: "confirmed" }, { amountCents: 1000, status: "reported" }] }));
    expect(p.outstandingCents).toBe(3000);
    expect(p.pendingCents).toBe(1000);
    expect(reportableCents(split({ settlements: [{ amountCents: 2000, status: "confirmed" }, { amountCents: 1000, status: "reported" }] }))).toBe(2000);
  });
  it("from both sides", () => {
    const s = [split({}), split({ id: "2", memberId: "a", payerMemberId: "c", amountCents: 1234 })];
    expect(memberTotals(s, "a")).toMatchObject({ youOwe: 1234, owedToYou: 5000 });
    expect(memberTotals(s, "b")).toMatchObject({ youOwe: 5000, owedToYou: 0 });
  });
});

describe("dueState", () => {
  it("classifies", () => {
    expect(dueState("2026-10-20", 100, "2026-10-24")).toBe("overdue");
    expect(dueState("2026-10-29", 100, "2026-10-24")).toBe("due_soon");
    expect(dueState("2026-11-29", 100, "2026-10-24")).toBe("upcoming");
    expect(dueState("2026-10-20", 0, "2026-10-24")).toBe("settled");
    expect(dueState(null, 100, "2026-10-24")).toBe("no_due_date");
  });
});

describe("statement extraction", () => {
  const comed = `ComEd An Exelon Company
Account Number 1234-567-890
Statement Number ST-88213
Billing Period: Sep 18, 2026 - Oct 17, 2026
Total Amount Due $184.40
Due Date Oct 29, 2026`;

  it("parses a clean statement without review", () => {
    const e = extractStatement(comed);
    expect(e.provider.value).toBe("ComEd");
    expect(e.amountDueCents.value).toBe(18440);
    expect(e.dueDate.value).toBe("2026-10-29");
    expect(e.periodStart).toBe("2026-09-18");
    expect(e.periodEnd).toBe("2026-10-17");
    expect(e.accountLast4).toBe("7890");
    expect(e.needsReview).toBe(false);
    expect(statementKey(e)).toBe("ComEd|7890|2026-09-18|2026-10-17");
  });

  it("handles labels with the value on the next line and numeric dates", () => {
    const e = extractStatement(`Southern Connecticut Gas\nAmount Due\n$96.12\nPayment Due Date: 11/03/2026`);
    expect(e.amountDueCents.value).toBe(9612);
    expect(e.dueDate.value).toBe("2026-11-03");
  });

  it("never invents details for a 'bill is ready' notice", () => {
    const e = extractStatement("Your ComEd bill is ready. Sign in to view your bill at comed.com.");
    expect(e.kind).toBe("notice_only");
    expect(e.amountDueCents.value).toBeNull();
    expect(e.dueDate.value).toBeNull();
    expect(e.needsReview).toBe(true);
  });

  it("flags conflicting amounts as ambiguous", () => {
    const e = extractStatement(`ComEd\nAmount Due $50.00\nTotal Amount Due $75.00\nDue Date 10/29/2026`);
    expect(e.amountDueCents.status).toBe("ambiguous");
    expect(e.needsReview).toBe(true);
  });

  it("flags large amounts for review", () => {
    expect(extractStatement(`ComEd\nAmount Due $1,450.00\nDue Date 10/29/2026`).reasons).toContain("Amount is unusually large");
  });

  it("rejects impossible dates", () => {
    expect(toISODate("02/30/2026")).toBeNull();
    expect(toISODate("Sept 3, 2026")).toBe("2026-09-03");
    expect(toISODate("December 1, 2026")).toBe("2026-12-01");
  });
});
