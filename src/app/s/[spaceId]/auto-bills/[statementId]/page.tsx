import Link from "next/link";
import type { Metadata } from "next";
import { getBills, getSpaceContext, getStatements } from "@/lib/data";
import { formatDate } from "@/lib/domain/due";
import { formatUSD } from "@/lib/domain/money";
import { StatementChip } from "@/components/status";
import { ReviewStatement } from "@/components/review-statement";
import { ButtonLink, Card, EmptyState, Notice } from "@/components/ui";
import { ViewStatement } from "@/components/bill-actions";

export const metadata: Metadata = { title: "Review statement" };

const PROVIDER_CATEGORY: Record<string, string> = {
  ComEd: "electricity", "Con Edison": "electricity", "PG&E": "electricity", Eversource: "electricity",
  "Southern Connecticut Gas": "gas", "Peoples Gas": "gas", Xfinity: "internet", Spectrum: "internet", Verizon: "phone", "AT&T": "phone",
};

export default async function StatementPage({ params }: { params: Promise<{ spaceId: string; statementId: string }> }) {
  const { spaceId, statementId } = await params;
  const ctx = (await getSpaceContext(spaceId))!;
  const statements = await getStatements(spaceId);
  const s = statements.find((x) => x.id === statementId);
  if (!s) return <EmptyState title="We couldn't find this statement" action={<ButtonLink href={`/s/${spaceId}/auto-bills`} variant="secondary">Auto Bills</ButtonLink>} />;

  const original = s.revision_of ? statements.find((x) => x.id === s.revision_of) : null;
  const bills = s.bill_id || original?.bill_id ? await getBills(spaceId, ctx) : [];
  const bill = bills.find((b) => b.id === (s.bill_id ?? original?.bill_id));
  const open = ["ready", "needs_review", "needs_statement", "failed"].includes(s.status);

  const fields: [string, string | null, boolean][] = [
    ["Provider", s.provider, !!s.provider],
    ["Amount due", s.amount_cents !== null ? formatUSD(s.amount_cents) : null, s.amount_cents !== null],
    ["Due date", s.due_date ? formatDate(s.due_date) : null, !!s.due_date],
    ["Billing period", s.period_start && s.period_end ? `${formatDate(s.period_start)} to ${formatDate(s.period_end)}` : null, !!s.period_start],
    ["Account", s.account_last4 ? `ending ${s.account_last4}` : null, !!s.account_last4],
  ];

  return (
    <div className="space-y-8 max-w-[1040px]">
      <Link href={`/s/${spaceId}/auto-bills`} className="text-[14px] text-ink-2 hover:text-ink">← Auto Bills</Link>
      <header className="rise">
        <div className="flex flex-wrap items-center gap-3"><StatementChip status={s.status} /><span className="text-[13px] text-muted">{s.source === "email" ? `Forwarded${s.sender ? ` from ${s.sender}` : ""}` : "Uploaded"} {formatDate(s.received_at.slice(0, 10))}</span></div>
        <h1 className="mt-3 text-[clamp(28px,5vw,40px)] font-semibold tracking-[-0.04em] leading-tight">
          {s.status === "needs_statement" ? "Statement details needed" : s.status === "failed" ? "We couldn't read this file" : s.status === "duplicate" ? "You've already sent this one" : open ? "We found a new bill" : s.provider ?? "Statement"}
        </h1>
        <p className="text-muted mt-2">
          {s.status === "needs_statement" ? "We received a bill notification, but not the amount or due date. Upload the statement to continue, or enter the details from the provider's site."
            : s.status === "failed" ? "The PDF may be a scanned image. Enter the details yourself, or try another copy."
            : s.status === "duplicate" ? "This statement matches one you already have, so we didn't create another charge."
            : open ? "Check the details before sharing." : "This statement has been handled."}
        </p>
      </header>

      {original && open && (
        <Notice tone="warning" title="This is a revised statement">
          It covers the same period as one you already have{original.amount_cents !== null ? ` (${formatUSD(original.amount_cents)}${original.due_date ? `, due ${formatDate(original.due_date)}` : ""})` : ""}. Confirming updates that bill instead of adding a second charge.
        </Notice>
      )}

      <div className="grid lg:grid-cols-[340px_minmax(0,1fr)] gap-8 items-start">
        <aside className="space-y-4 lg:sticky lg:top-8">
          <Card className="p-5">
            <p className="text-[13px] font-medium text-ink-2 mb-3">What we read</p>
            <dl className="space-y-3">
              {fields.map(([k, v, found]) => (
                <div key={k} className="flex items-start justify-between gap-3 text-[14px]">
                  <dt className="text-muted">{k}</dt>
                  <dd className="text-right">{found ? <span className="font-medium">{v}</span> : <span className="text-warning">Not found</span>}</dd>
                </div>
              ))}
            </dl>
            {s.reasons.length > 0 && (
              <ul className="mt-4 pt-4 border-t border-line space-y-1.5 text-[13px] text-warning">
                {s.reasons.map((r) => <li key={r} className="flex gap-2"><span aria-hidden="true">!</span>{r}</li>)}
              </ul>
            )}
            <p className="mt-4 pt-4 border-t border-line text-[12px] text-muted">Read by parser {s.parser_version}{s.file_name ? ` from ${s.file_name}` : ""}.</p>
            {s.file_path && <div className="mt-3"><ViewStatement path={s.file_path} /></div>}
          </Card>
        </aside>

        <div className="min-w-0">
          {open && ctx.me ? (
            <ReviewStatement
              spaceId={spaceId}
              statementId={s.id}
              initial={{
                title: s.provider ? `${PROVIDER_CATEGORY[s.provider] ? PROVIDER_CATEGORY[s.provider][0].toUpperCase() + PROVIDER_CATEGORY[s.provider].slice(1) : "Bill"} · ${s.provider}` : "",
                category: (s.provider && PROVIDER_CATEGORY[s.provider]) ?? "other",
                amount: s.amount_cents, dueDate: s.due_date, periodStart: s.period_start, periodEnd: s.period_end,
              }}
              revisionPayerId={bill?.payer.id ?? null}
              defaultMethod={ctx.space.default_split}
              meId={ctx.me.id}
              isOwner={ctx.me.role === "owner"}
              members={ctx.active.map((m) => ({ id: m.id, name: m.placeholder ? `${m.name} (not joined)` : m.name, isMe: m.id === ctx.me!.id }))}
            />
          ) : bill ? (
            <Card className="p-6">
              <p className="text-[15px]">Shared as <Link className="font-medium underline underline-offset-4" href={`/s/${spaceId}/bills/${bill.id}`}>{bill.title}</Link>, {formatUSD(bill.amount_cents)}{bill.due_date ? `, due ${formatDate(bill.due_date)}` : ""}.</p>
            </Card>
          ) : (
            <Card className="p-6 text-[15px] text-muted">Nothing to do here.</Card>
          )}
        </div>
      </div>
    </div>
  );
}
