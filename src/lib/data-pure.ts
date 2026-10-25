import type { Statement } from "./data";
import { todayISO } from "./domain/due";

/**
 * Providers we have published before whose next statement is overdue to arrive.
 * Silence never means "paid": this produces the "We haven't received this month's bill" alert.
 */
export function missingStatements(statements: Statement[], today = todayISO()) {
  const latest = new Map<string, Statement>();
  for (const s of statements) {
    if (s.status !== "published" || !s.provider) continue;
    const prev = latest.get(s.provider);
    if (!prev || (s.period_end ?? s.received_at) > (prev.period_end ?? prev.received_at)) latest.set(s.provider, s);
  }
  const out: { provider: string; lastPeriodEnd: string | null; lastReceived: string }[] = [];
  for (const [provider, s] of latest) {
    const anchor = s.period_end ?? s.received_at.slice(0, 10);
    const days = (Date.parse(today) - Date.parse(anchor)) / 86_400_000;
    if (days > 40) out.push({ provider, lastPeriodEnd: s.period_end, lastReceived: s.received_at });
  }
  return out;
}
