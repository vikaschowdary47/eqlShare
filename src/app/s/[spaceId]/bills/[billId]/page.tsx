import Link from "next/link";
import type { Metadata } from "next";
import { getActivity, getBills, getSpaceContext, getStatements } from "@/lib/data";
import { reportableCents } from "@/lib/domain/balances";
import { formatDate } from "@/lib/domain/due";
import { formatUSD } from "@/lib/domain/money";
import { env } from "@/lib/env";
import { ActivityList } from "@/components/activity";
import { CATEGORY_LABEL, CategoryGlyph, DueChip, ShareChip, UtilityChip } from "@/components/status";
import { Avatar, ButtonLink, Card, Chip, EmptyState, Money, Notice, SectionTitle, ShareBar } from "@/components/ui";
import { ConfirmSettlement, EditBill, MemberShareActions, RemindButton, ResolveDispute, UtilityPaid, ViewStatement } from "@/components/bill-actions";

export const metadata: Metadata = { title: "Bill" };

const SOURCE = { manual: "Entered by hand", upload: "Uploaded statement", email: "Forwarded email", import: "Imported from Splitwise" } as const;

export default async function BillPage({ params, searchParams }: { params: Promise<{ spaceId: string; billId: string }>; searchParams: Promise<{ created?: string }> }) {
  const { spaceId, billId } = await params;
  const { created } = await searchParams;
  const ctx = (await getSpaceContext(spaceId))!;
  const [bills, statements, activity] = await Promise.all([getBills(spaceId, ctx, { includeVoid: true }), getStatements(spaceId), getActivity(spaceId, 200)]);
  const bill = bills.find((b) => b.id === billId);
  if (!bill) {
    return <EmptyState title="We couldn't find this bill" action={<ButtonLink href={`/s/${spaceId}/bills`} variant="secondary">All bills</ButtonLink>}>It may have been removed, or the link is wrong.</EmptyState>;
  }

  const meId = ctx.formerMe?.id ?? null;
  const iPaid = bill.payer.id === meId;
  const canEdit = !!ctx.me && (iPaid || ctx.me.role === "owner") && bill.status === "published";
  const statement = statements.find((s) => s.id === bill.statement_id);
  const history = activity.filter((a) => a.entity_id === bill.id || a.metadata.bill_id === bill.id).slice(0, 20);
  const payerFirst = iPaid ? "you" : bill.payer.name.split(" ")[0];
  const locked = bill.splits.some((s) => s.settlements.some((x) => x.status === "reported" || x.status === "confirmed"));
  const link = `${env.siteUrl()}/s/${spaceId}/bills/${bill.id}`;

  return (
    <div className="space-y-8 max-w-[880px]">
      <Link href={`/s/${spaceId}/bills`} className="text-[14px] text-ink-2 hover:text-ink">← Bills</Link>
      {created && <Notice tone="success" title="Bill saved">Everyone in this split can now see it and their share.</Notice>}
      {bill.status === "void" && <Notice tone="warning" title="This bill was voided">Shares are cancelled. History is kept below.</Notice>}

      <header className="flex items-start gap-4 rise">
        <CategoryGlyph category={bill.category} size={52} />
        <div className="flex-1 min-w-0">
          <h1 className="text-[clamp(26px,5vw,36px)] font-semibold tracking-[-0.04em] leading-tight">{bill.title}</h1>
          <div className="mt-2 flex flex-wrap gap-2">
            {bill.source === "import" ? <Chip tone="teal">Opening balance · imported from Splitwise</Chip>
              : bill.status === "published" && <DueChip state={bill.overall} dueDate={bill.due_date} />}
            <UtilityChip status={bill.utility_status} />
            {bill.disputed && <Chip tone="error">Disputed</Chip>}
          </div>
        </div>
        {canEdit && <EditBill spaceId={spaceId} bill={{ id: bill.id, version: bill.version, title: bill.title, category: bill.category, due_date: bill.due_date, note: bill.note, locked }} />}
      </header>

      <Card className="p-6 sm:p-8 rise-2">
        <div className="grid sm:grid-cols-[1fr_auto] gap-6 items-end">
          <div>
            <p className="text-[14px] text-muted">Total</p>
            <Money cents={bill.amount_cents} size="lg" className="block mt-1" />
            <p className="mt-2 text-[15px] text-ink-2">{bill.source === "import" ? `Owed to ${iPaid ? "you" : bill.payer.name}, carried over from Splitwise on ${formatDate(bill.bill_date)}` : `${iPaid ? "You" : bill.payer.name} paid upfront`}</p>
          </div>
          {bill.mine && !iPaid && (
            <div className="sm:text-right">
              <p className="text-[14px] text-muted">Your share</p>
              <p className="figure text-[32px]">{formatUSD(bill.mine.amount_cents)}</p>
            </div>
          )}
        </div>
        <ShareBar className="mt-6" parts={bill.splits.map((s) => ({
          key: s.id, cents: s.amount_cents,
          state: s.position.isPayerOwnShare ? "own" : s.position.outstandingCents === 0 ? "paid" : s.position.pendingCents > 0 ? "pending" : "open",
        }))} />
        <dl className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4 text-[14px]">
          <div><dt className="text-muted">Due</dt><dd className="font-medium mt-0.5">{bill.due_date ? formatDate(bill.due_date) : "No due date"}</dd></div>
          <div><dt className="text-muted">Billing period</dt><dd className="font-medium mt-0.5">{bill.period_start && bill.period_end ? `${formatDate(bill.period_start)} to ${formatDate(bill.period_end)}` : "Not set"}</dd></div>
          <div><dt className="text-muted">Category</dt><dd className="font-medium mt-0.5">{CATEGORY_LABEL[bill.category]}</dd></div>
          <div><dt className="text-muted">Source</dt><dd className="font-medium mt-0.5">{statement ? <Link className="underline underline-offset-4 decoration-line-strong" href={`/s/${spaceId}/auto-bills/${statement.id}`}>{SOURCE[bill.source]}</Link> : SOURCE[bill.source]}</dd></div>
        </dl>
        {bill.note && <p className="mt-5 text-[14px] text-ink-2 rounded-[12px] bg-sunken px-4 py-3">{bill.note}</p>}
      </Card>

      {bill.utility_status !== "not_applicable" && bill.status === "published" && (
        <section aria-labelledby="prov">
          <SectionTitle id="prov">Provider payment</SectionTitle>
          <Card className="p-5 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex-1">
              <p className="text-[15px]"><strong className="font-medium">{iPaid ? "You pay" : `${bill.payer.name} pays`}</strong> the provider{statement?.provider ? ` (${statement.provider})` : ""}.</p>
              <p className="text-[14px] text-muted mt-0.5">
                {bill.utility_status === "payment_reported" ? `${iPaid ? "You" : payerFirst} reported paying it. Eqlshare can't verify provider payments.` : "This is separate from paying back the people who split it."}
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {statement?.file_path && <ViewStatement path={statement.file_path} />}
              {iPaid && bill.utility_status === "unpaid" && <UtilityPaid spaceId={spaceId} billId={bill.id} />}
            </div>
          </Card>
        </section>
      )}

      <section aria-labelledby="shares">
        <SectionTitle id="shares">Shares</SectionTitle>
        <Card className="divide-y divide-line">
          {bill.splits.map((s) => {
            const isMe = s.member.id === meId;
            const reported = s.settlements.filter((x) => x.status === "reported");
            return (
              <div key={s.id} className="px-4 sm:px-5 py-4">
                <div className="flex items-center gap-3">
                  <Avatar name={s.member.name} size={36} muted={s.member.status === "inactive"} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[15px] font-medium truncate">{isMe ? "You" : s.member.name}{s.member.status === "inactive" && <span className="text-muted font-normal"> · left</span>}{s.member.placeholder && <span className="text-muted font-normal"> · not joined</span>}</p>
                    <p className="text-[13px] text-muted">
                      {s.position.isPayerOwnShare ? "Own share, nothing to pay back"
                        : s.position.outstandingCents === 0 ? `Paid back ${formatUSD(s.position.confirmedCents)}`
                        : `${formatUSD(s.position.outstandingCents)} owed to ${payerFirst}${s.position.confirmedCents ? ` · ${formatUSD(s.position.confirmedCents)} confirmed` : ""}`}
                    </p>
                  </div>
                  <div className="text-right flex flex-col items-end gap-1">
                    <span className="num text-[15px] font-semibold">{formatUSD(s.amount_cents)}</span>
                    <ShareChip position={s.position} disputed={!!s.disputed_at} />
                  </div>
                </div>

                {s.disputed_at && (
                  <div className="mt-3 ml-12 rounded-[12px] bg-error-wash px-4 py-3 text-[14px]">
                    <p className="text-error font-medium">Share disputed</p>
                    <p className="text-ink-2">{s.dispute_note ?? "No note added."}</p>
                    {(isMe || iPaid || ctx.me?.role === "owner") && <div className="mt-2"><ResolveDispute spaceId={spaceId} splitId={s.id} /></div>}
                  </div>
                )}

                {s.settlements.length > 0 && (
                  <ul className="mt-3 ml-12 space-y-1.5 text-[13px]">
                    {s.settlements.map((x) => (
                      <li key={x.id} className="flex flex-wrap items-center gap-2 text-ink-2">
                        <Chip tone={x.status === "confirmed" ? "success" : x.status === "reported" ? "warning" : x.status === "disputed" ? "error" : "neutral"}>
                          {{ reported: "Payment reported", confirmed: "Confirmed received", disputed: "Marked not received", reversed: "Reversed" }[x.status]}
                        </Chip>
                        <span className="num">{formatUSD(x.amount_cents)}</span>
                        {x.method && <span>via {x.method}</span>}
                        <span className="text-muted">· {formatDate((x.confirmed_at ?? x.reported_at).slice(0, 10))}</span>
                        {x.note && <span className="w-full text-muted">“{x.note}”</span>}
                      </li>
                    ))}
                  </ul>
                )}

                {bill.status === "published" && (
                  <div className="ml-12">
                    {iPaid && reported.map((x) => <ConfirmSettlement key={x.id} spaceId={spaceId} settlementId={x.id} amountCents={x.amount_cents} from={s.member.name.split(" ")[0]} />)}
                    {iPaid && !isMe && s.member.placeholder && s.position.outstandingCents > 0 && (
                      <p className="mt-2 text-[13px] text-muted">{s.member.name} hasn't joined yet, so they can't get reminders. <Link className="text-teal-ink underline underline-offset-4" href={`/s/${spaceId}/space#members`}>Send invite</Link></p>
                    )}
                    {iPaid && !isMe && !s.member.placeholder && bill.source !== "import" && s.position.outstandingCents > 0 && s.position.pendingCents === 0 && s.member.status === "active" && (
                      <RemindButton spaceId={spaceId} splitId={s.id} link={link}
                        message={`Hi ${s.member.name.split(" ")[0]}, your share of ${bill.title} is ${formatUSD(s.position.outstandingCents)}${bill.due_date ? `, due ${formatDate(bill.due_date)}` : ""}.`} />
                    )}
                    {isMe && !iPaid && (
                      <MemberShareActions spaceId={spaceId} splitId={s.id} payerFirst={bill.payer.name.split(" ")[0]} disputed={!!s.disputed_at}
                        reportableCents={reportableCents({ id: s.id, memberId: s.member.id, payerMemberId: bill.payer.id, amountCents: s.amount_cents, settlements: s.settlements.map((x) => ({ amountCents: x.amount_cents, status: x.status })) })} />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </Card>
        {bill.splits.length < ctx.members.length && <p className="text-[13px] text-muted mt-2">Only the people above share this bill.</p>}
      </section>

      <section aria-labelledby="hist">
        <SectionTitle id="hist">History</SectionTitle>
        <Card className="overflow-hidden">
          {history.length ? <ActivityList items={history} members={ctx.members} meUserId={ctx.userId} spaceId={spaceId} /> : <p className="p-5 text-[14px] text-muted">No history yet.</p>}
        </Card>
      </section>
    </div>
  );
}
