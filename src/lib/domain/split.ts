import { assertCents, type Cents } from "./money";

export type SplitMethod = "equal" | "exact" | "percent";

export interface ShareInput {
  memberId: string;
  /** exact: cents. percent: basis points (100.00% = 10000). equal: ignored. */
  value?: number;
}

export interface Share {
  memberId: string;
  amountCents: Cents;
}

export type SplitResult =
  | { ok: true; shares: Share[] }
  | { ok: false; error: string; differenceCents?: Cents };

/**
 * Deterministic split. Member order is the caller's order (we sort by joined order upstream),
 * and leftover cents always go to the earliest members, so $100.00 / 3 = [3334, 3333, 3333].
 */
export function splitBill(totalCents: Cents, method: SplitMethod, inputs: ShareInput[]): SplitResult {
  assertCents(totalCents, "total");
  if (totalCents <= 0) return { ok: false, error: "Total must be more than $0.00" };
  if (inputs.length === 0) return { ok: false, error: "Choose at least one person" };
  if (new Set(inputs.map((i) => i.memberId)).size !== inputs.length)
    return { ok: false, error: "Each person can appear only once" };

  if (method === "equal") {
    const base = Math.floor(totalCents / inputs.length);
    const rem = totalCents % inputs.length;
    return { ok: true, shares: inputs.map((m, i) => ({ memberId: m.memberId, amountCents: base + (i < rem ? 1 : 0) })) };
  }

  if (method === "exact") {
    for (const i of inputs) {
      if (i.value === undefined || !Number.isSafeInteger(i.value) || i.value < 0)
        return { ok: false, error: "Every share must be $0.00 or more" };
    }
    const sum = inputs.reduce((a, i) => a + (i.value as number), 0);
    if (sum !== totalCents)
      return { ok: false, error: "Shares must add up to the total", differenceCents: totalCents - sum };
    return { ok: true, shares: inputs.map((i) => ({ memberId: i.memberId, amountCents: i.value as number })) };
  }

  // percent, in basis points; largest-remainder method with stable tie-break on input order
  for (const i of inputs) {
    if (i.value === undefined || !Number.isSafeInteger(i.value) || i.value < 0)
      return { ok: false, error: "Every percentage must be 0% or more" };
  }
  const bps = inputs.reduce((a, i) => a + (i.value as number), 0);
  if (bps !== 10000) return { ok: false, error: "Percentages must add up to 100%" };
  const raw = inputs.map((i, idx) => {
    const exact = totalCents * (i.value as number);
    return { idx, floor: Math.floor(exact / 10000), rem: exact % 10000 };
  });
  let left = totalCents - raw.reduce((a, r) => a + r.floor, 0);
  const order = [...raw].sort((a, b) => b.rem - a.rem || a.idx - b.idx);
  const extra = new Array(inputs.length).fill(0);
  for (const r of order) {
    if (left === 0) break;
    extra[r.idx] = 1;
    left--;
  }
  return { ok: true, shares: inputs.map((i, idx) => ({ memberId: i.memberId, amountCents: raw[idx].floor + extra[idx] })) };
}

/** Parse "33.5" percent into basis points (3350). */
export function percentToBps(input: string): number | null {
  if (!/^\d{1,3}(\.\d{0,2})?$/.test(input.trim())) return null;
  const [w, f = ""] = input.trim().split(".");
  const v = Number(w) * 100 + Number(f.padEnd(2, "0"));
  return v <= 10000 ? v : null;
}
