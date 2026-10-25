import Link from "next/link";
import type { Metadata } from "next";
import { getSpaceContext, getStatements, missingStatements, type Statement } from "@/lib/data";
import { formatDate } from "@/lib/domain/due";
import { formatUSD } from "@/lib/domain/money";
import { env } from "@/lib/env";
import { StatementChip } from "@/components/status";
import { UploadStatement } from "@/components/upload-statement";
import { CopyField } from "@/components/copy-field";
import { Card, Chip, Notice, SectionTitle } from "@/components/ui";

export const metadata: Metadata = { title: "Auto Bills" };

function Row({ s, spaceId }: { s: Statement; spaceId: string }) {
  return (
    <Link href={`/s/${spaceId}/auto-bills/${s.id}`} className="flex items-center gap-4 px-4 sm:px-5 py-4 hover:bg-sunken/60">
      <span className="grid place-items-center size-10 rounded-[12px] bg-sunken ring-1 ring-line text-[12px] font-semibold text-ink-2 shrink-0" aria-hidden="true">
        {s.source === "email" ? "@" : "PDF"}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-medium truncate">{s.provider ?? "Unrecognized provider"}</p>
        <p className="text-[13px] text-muted truncate">
          {s.amount_cents !== null ? formatUSD(s.amount_cents) : "Amount unknown"} · {s.due_date ? `due ${formatDate(s.due_date)}` : "due date unknown"} · {s.source === "email" ? "forwarded" : "uploaded"} {formatDate(s.received_at.slice(0, 10))}
        </p>
      </div>
      <StatementChip status={s.status} />
    </Link>
  );
}

export default async function AutoBillsPage({ params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;
  const ctx = (await getSpaceContext(spaceId))!;
  const statements = await getStatements(spaceId);
  const open = statements.filter((s) => ["ready", "needs_review", "needs_statement", "failed"].includes(s.status));
  const done = statements.filter((s) => !open.includes(s));
  const missing = missingStatements(statements);
  const forwardingLive = !!process.env.INBOUND_WEBHOOK_SECRET && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  const address = `bills+${ctx.space.inbound_token}@${env.inboundDomain()}`;

  return (
    <div className="space-y-10 max-w-[920px]">
      <header className="rise">
        <Link href={`/s/${spaceId}/bills`} className="text-[14px] text-ink-2 hover:text-ink">← Bills</Link>
        <h1 className="mt-4 text-[clamp(28px,5vw,40px)] font-semibold tracking-[-0.04em] leading-tight">Auto Bills</h1>
        <p className="text-muted mt-2 max-w-[60ch]">Send us your statements. We read the provider, amount, due date and billing period. You check them, then everyone sees their share. We never make up a missing detail.</p>
      </header>

      {missing.map((m) => (
        <Notice key={m.provider} tone="warning" title={`We haven't received this month's ${m.provider} bill`}>
          The last one covered a period ending {m.lastPeriodEnd ? formatDate(m.lastPeriodEnd) : "over a month ago"}. That doesn't mean it's paid. Check the provider's site or your email, then upload the statement.
        </Notice>
      ))}

      {open.length > 0 && (
        <section aria-labelledby="todo">
          <SectionTitle id="todo">Waiting for you</SectionTitle>
          <Card className="divide-y divide-line overflow-hidden">{open.map((s) => <Row key={s.id} s={s} spaceId={spaceId} />)}</Card>
        </section>
      )}

      {ctx.me && (
        <div className="grid md:grid-cols-2 gap-6 items-start">
          <section aria-labelledby="up" className="space-y-3">
            <div className="flex items-center justify-between"><h2 id="up" className="text-[17px] font-semibold tracking-[-0.01em]">Upload a statement</h2><Chip tone="success">Available</Chip></div>
            <UploadStatement spaceId={spaceId} />
          </section>

          <section id="forwarding" aria-labelledby="fw" className="space-y-3 scroll-mt-24">
            <div className="flex items-center justify-between"><h2 id="fw" className="text-[17px] font-semibold tracking-[-0.01em]">Forward bill emails</h2>{forwardingLive ? <Chip tone="success">On</Chip> : <Chip>Coming soon</Chip>}</div>
            <Card className="p-5 space-y-4">
              {!forwardingLive && <Notice tone="neutral" title="Forwarding isn't switched on yet">Your address is reserved for this Space. Until forwarding is on, upload the PDF instead.</Notice>}
              <CopyField label="This Space's private address" value={address} mono />
              <ol className="space-y-2.5 text-[14px] text-ink-2 list-decimal pl-5 marker:text-muted">
                <li>In your email, open a bill from your provider, for example ComEd.</li>
                <li>Forward it, with the PDF attached if there is one, to the address above.</li>
                <li>To do this automatically, create a filter for the provider's sender and forward matches here. You can turn the filter off anytime.</li>
              </ol>
              <p className="text-[13px] text-muted">Many providers only email "your bill is ready" with a sign-in link. When that happens we'll ask you for the statement instead of guessing the amount.</p>
            </Card>
          </section>
        </div>
      )}

      {done.length > 0 && (
        <section aria-labelledby="past">
          <SectionTitle id="past">History</SectionTitle>
          <Card className="divide-y divide-line overflow-hidden">{done.map((s) => <Row key={s.id} s={s} spaceId={spaceId} />)}</Card>
        </section>
      )}
    </div>
  );
}
