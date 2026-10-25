import Link from "next/link";
import type { Metadata } from "next";
import { getBills, getSpaceContext, getStatements, type BillView } from "@/lib/data";
import { SPACE_PRESETS } from "@/lib/domain/spaces";
import { BillRow } from "@/components/bill-row";
import { ButtonLink, Card, EmptyState, cx } from "@/components/ui";

export const metadata: Metadata = { title: "Bills" };

const FILTERS = [
  { key: "upcoming", label: "Upcoming" },
  { key: "all", label: "All" },
  { key: "overdue", label: "Overdue" },
  { key: "settled", label: "Settled" },
] as const;
type F = (typeof FILTERS)[number]["key"];

function stateFor(b: BillView, meId: string | null) {
  if (b.payer.id === meId || !b.mine) return b.overall;
  return b.myDue;
}

export default async function BillsPage({ params, searchParams }: { params: Promise<{ spaceId: string }>; searchParams: Promise<{ f?: string }> }) {
  const { spaceId } = await params;
  const { f: raw } = await searchParams;
  const f: F = FILTERS.some((x) => x.key === raw) ? (raw as F) : "upcoming";
  const ctx = (await getSpaceContext(spaceId))!;
  const [bills, statements] = await Promise.all([getBills(spaceId, ctx, { includeVoid: f === "all" }), getStatements(spaceId)]);
  const meId = ctx.formerMe?.id ?? null;
  const preset = SPACE_PRESETS[ctx.space.type];

  const counts: Record<F, number> = { upcoming: 0, all: bills.length, overdue: 0, settled: 0 };
  for (const b of bills) {
    if (b.status === "void") continue;
    const s = stateFor(b, meId);
    if (s === "overdue") counts.overdue++;
    if (s === "settled") counts.settled++;
    if (s !== "settled" && s !== "overdue") counts.upcoming++;
  }
  const shown = bills.filter((b) => {
    if (f === "all") return true;
    const s = stateFor(b, meId);
    if (f === "settled") return s === "settled";
    if (f === "overdue") return s === "overdue";
    return s !== "settled" && s !== "overdue";
  });
  const pendingReview = statements.filter((s) => ["ready", "needs_review", "needs_statement", "failed"].includes(s.status)).length;

  return (
    <div className="space-y-8">
      <header className="flex items-end justify-between gap-4 rise">
        <div>
          <h1 className="text-[clamp(28px,5vw,40px)] font-semibold tracking-[-0.04em] leading-tight">Bills</h1>
          <p className="text-muted mt-1">Every {preset.expenseNoun} in {ctx.space.name}, with your share.</p>
        </div>
        {ctx.me && <ButtonLink href={`/s/${spaceId}/bills/new`} className="hidden sm:inline-flex">Add {preset.expenseNoun}</ButtonLink>}
      </header>

      <Link href={`/s/${spaceId}/auto-bills`} className="group flex items-center gap-4 rounded-[18px] bg-night text-white p-5 grain overflow-hidden relative rise-2">
        <span className="grid place-items-center size-11 rounded-[12px] bg-white/10 ring-1 ring-white/15 shrink-0" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7l8 6 8-6" /><rect x="3" y="5" width="18" height="14" rx="2.5" /></svg>
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-semibold">Auto Bills</span>
          <span className="block text-[14px] text-white/65">{pendingReview ? `${pendingReview} ${pendingReview === 1 ? "statement needs" : "statements need"} your review` : "Upload or forward statements. We read them, you confirm."}</span>
        </span>
        <span aria-hidden="true" className="transition-transform duration-300 group-hover:translate-x-1">→</span>
      </Link>

      <nav aria-label="Filter bills" className="flex gap-1 p-1 rounded-[14px] bg-sunken ring-1 ring-line w-full sm:w-fit overflow-x-auto">
        {FILTERS.map((x) => (
          <Link key={x.key} href={`/s/${spaceId}/bills?f=${x.key}`} aria-current={f === x.key ? "page" : undefined}
            className={cx("flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 h-9 px-4 rounded-[10px] text-[14px] whitespace-nowrap transition-all",
              f === x.key ? "bg-surface text-ink font-medium shadow-[0_1px_3px_rgba(11,26,24,0.12)]" : "text-ink-2 hover:text-ink")}>
            {x.label}<span className={cx("num text-[12px]", x.key === "overdue" && counts.overdue > 0 ? "text-error" : "text-muted")}>{counts[x.key]}</span>
          </Link>
        ))}
      </nav>

      {shown.length ? (
        <Card className="divide-y divide-line overflow-hidden">{shown.map((b) => <BillRow key={b.id} bill={b} spaceId={spaceId} meId={meId} />)}</Card>
      ) : (
        <EmptyState
          title={{ upcoming: "Nothing coming up", all: `No ${preset.expenseNoun}s yet`, overdue: "Nothing overdue", settled: "Nothing settled yet" }[f]}
          action={f === "all" || f === "upcoming" ? <ButtonLink href={`/s/${spaceId}/bills/new`}>Add {preset.expenseNoun}</ButtonLink> : undefined}>
          {{ upcoming: "When a bill has an open share, it appears here.", all: "Add one yourself or upload a statement.", overdue: "Good news. Every share with a past due date is settled.", settled: "Bills move here once every share is confirmed received." }[f]}
        </EmptyState>
      )}
    </div>
  );
}
