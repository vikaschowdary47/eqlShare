export type DueState = "settled" | "overdue" | "due_soon" | "upcoming" | "no_due_date";

export const DUE_SOON_DAYS = 5;

/** Dates are ISO yyyy-mm-dd (calendar dates, no time zone shifts). */
export function daysUntil(dueDate: string, today: string): number {
  const a = Date.UTC(...ymd(today));
  const b = Date.UTC(...ymd(dueDate));
  return Math.round((b - a) / 86_400_000);
}

function ymd(s: string): [number, number, number] {
  const [y, m, d] = s.split("-").map(Number);
  return [y, m - 1, d];
}

export function dueState(dueDate: string | null, outstandingCents: number, today: string): DueState {
  if (outstandingCents === 0) return "settled";
  if (!dueDate) return "no_due_date";
  const d = daysUntil(dueDate, today);
  if (d < 0) return "overdue";
  if (d <= DUE_SOON_DAYS) return "due_soon";
  return "upcoming";
}

export function todayISO(now = new Date()): string {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

const fmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
export function formatDate(iso: string | null): string {
  if (!iso) return "No date";
  return fmt.format(new Date(iso + "T00:00:00Z"));
}
