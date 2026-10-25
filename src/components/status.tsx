import { Chip } from "./ui";
import type { DueState } from "@/lib/domain/due";
import { daysUntil, todayISO } from "@/lib/domain/due";
import type { SplitPosition } from "@/lib/domain/balances";
import type { Statement, UtilityStatus } from "@/lib/data";

export function DueChip({ state, dueDate }: { state: DueState; dueDate: string | null }) {
  if (state === "settled") return <Chip tone="success">Settled</Chip>;
  if (state === "overdue") return <Chip tone="error">Overdue</Chip>;
  if (state === "no_due_date") return <Chip>No due date</Chip>;
  if (state === "due_soon" && dueDate) {
    const d = daysUntil(dueDate, todayISO());
    return <Chip tone="warning">{d === 0 ? "Due today" : d === 1 ? "Due tomorrow" : `Due in ${d} days`}</Chip>;
  }
  return <Chip tone="teal">Upcoming</Chip>;
}

/** Status of one person's share, from anyone's point of view. */
export function ShareChip({ position, disputed }: { position: SplitPosition; disputed?: boolean }) {
  if (position.isPayerOwnShare) return <Chip>Paid upfront</Chip>;
  if (disputed || position.disputed) return <Chip tone="error">Disputed</Chip>;
  if (position.outstandingCents === 0) return <Chip tone="success">Confirmed received</Chip>;
  if (position.pendingCents > 0) return <Chip tone="warning">Payment reported</Chip>;
  if (position.confirmedCents > 0) return <Chip tone="teal">Partly paid</Chip>;
  return <Chip>Awaiting payment</Chip>;
}

export function UtilityChip({ status }: { status: UtilityStatus }) {
  if (status === "not_applicable") return null;
  if (status === "provider_verified") return <Chip tone="success">Provider confirmed paid</Chip>;
  if (status === "payment_reported") return <Chip tone="warning">Utility payment unverified</Chip>;
  return <Chip>Provider not yet paid</Chip>;
}

export const STATEMENT_LABEL: Record<Statement["status"], { label: string; tone: "neutral" | "teal" | "success" | "warning" | "error" }> = {
  ready: { label: "Ready to confirm", tone: "teal" },
  needs_review: { label: "Needs review", tone: "warning" },
  needs_statement: { label: "Statement details needed", tone: "warning" },
  duplicate: { label: "Duplicate", tone: "neutral" },
  failed: { label: "Couldn't read", tone: "error" },
  published: { label: "Shared as bill", tone: "success" },
  rejected: { label: "Dismissed", tone: "neutral" },
};

export function StatementChip({ status }: { status: Statement["status"] }) {
  const s = STATEMENT_LABEL[status];
  return <Chip tone={s.tone}>{s.label}</Chip>;
}

export const CATEGORY_LABEL: Record<string, string> = {
  electricity: "Electricity", gas: "Gas", water: "Water", internet: "Internet", rent: "Rent", phone: "Phone",
  groceries: "Groceries", travel: "Travel", dining: "Dining", other: "Other",
};

export function CategoryGlyph({ category, size = 40 }: { category: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    electricity: <path d="M13 3L6 13h5l-1 8 7-10h-5l1-8z" />,
    gas: <path d="M12 3c2 3 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-8z" />,
    water: <path d="M12 3s6 7 6 11a6 6 0 0 1-12 0c0-4 6-11 6-11z" />,
    internet: <><path d="M3 9a13 13 0 0 1 18 0" /><path d="M6 12.5a8.5 8.5 0 0 1 12 0" /><path d="M9 16a4 4 0 0 1 6 0" /><circle cx="12" cy="19" r="0.8" /></>,
    rent: <><path d="M4 11l8-7 8 7" /><path d="M6 10v10h12V10" /><path d="M10 20v-5h4v5" /></>,
    phone: <><rect x="7" y="3" width="10" height="18" rx="2.5" /><path d="M11 18h2" /></>,
    groceries: <><path d="M4 6h2l2 10h10l2-7H7" /><circle cx="9" cy="19.5" r="1" /><circle cx="17" cy="19.5" r="1" /></>,
    travel: <path d="M3 13l18-7-6 15-3-6-9-2z" />,
    dining: <><path d="M7 3v8a2 2 0 0 0 2 2v8" /><path d="M11 3v8" /><path d="M17 3c-2 2-2 6 0 8v10" /></>,
    other: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M9 9h6M9 13h6M9 17h3" /></>,
  };
  return (
    <span className="grid place-items-center rounded-[12px] bg-sunken text-ink-2 shrink-0 ring-1 ring-line" style={{ width: size, height: size }} aria-hidden="true">
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        {paths[category] ?? paths.other}
      </svg>
    </span>
  );
}
