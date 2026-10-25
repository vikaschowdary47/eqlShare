import type { BillView, Statement } from "./data";
import { missingStatements } from "./data-pure";
import { formatUSD } from "./domain/money";
import { formatDate } from "./domain/due";

export interface AttentionItem {
  key: string;
  tone: "error" | "warning" | "teal";
  title: string;
  detail: string;
  href: string;
  cta: string;
}

/** Everything the viewer should act on, most urgent first. */
export function buildAttention(spaceId: string, bills: BillView[], statements: Statement[], meId: string | null, today: string): AttentionItem[] {
  const out: AttentionItem[] = [];
  const bill = (b: BillView) => `/s/${spaceId}/bills/${b.id}`;

  for (const b of bills) {
    if (b.status !== "published") continue;
    const iPaid = b.payer.id === meId;
    const mine = b.mine;
    if (mine && !iPaid && b.myDue === "overdue" && mine.position.pendingCents === 0)
      out.push({ key: `od-${b.id}`, tone: "error", title: `${b.title} is overdue`, detail: `Your share ${formatUSD(mine.position.outstandingCents)} was due ${formatDate(b.due_date)}. Pay ${b.payer.name.split(" ")[0]}, then record it.`, href: bill(b), cta: "Record payment" });
    if (iPaid) {
      const waiting = b.splits.flatMap((s) => s.settlements.filter((x) => x.status === "reported").map((x) => ({ s, x })));
      for (const { s, x } of waiting)
        out.push({ key: `conf-${x.id}`, tone: "warning", title: `Confirm ${formatUSD(x.amount_cents)} from ${s.member.name.split(" ")[0]}`, detail: `${s.member.name.split(" ")[0]} reported paying their share of ${b.title}. Confirm once the money arrives.`, href: bill(b), cta: "Review" });
      const disputed = b.splits.filter((s) => s.disputed_at);
      for (const s of disputed)
        out.push({ key: `dis-${s.id}`, tone: "error", title: `${s.member.name.split(" ")[0]} disputed their share`, detail: `${b.title}: ${s.dispute_note ?? "No note added."}`, href: bill(b), cta: "Review" });
      if (b.overall === "overdue")
        out.push({ key: `odp-${b.id}`, tone: "error", title: `${b.title}: ${formatUSD(b.outstandingCents)} still owed to you`, detail: `It was due ${formatDate(b.due_date)}. You can send a reminder.`, href: bill(b), cta: "Remind" });
      if (b.utility_status === "unpaid" && b.due_date && b.due_date < today)
        out.push({ key: `util-${b.id}`, tone: "warning", title: `Did you pay the provider for ${b.title}?`, detail: "Eqlshare can't see provider payments. Mark it when you've paid so the Space knows.", href: bill(b), cta: "Update" });
    }
  }

  for (const s of statements) {
    const href = `/s/${spaceId}/auto-bills/${s.id}`;
    const name = s.provider ?? "A statement";
    if (s.status === "needs_review") out.push({ key: `st-${s.id}`, tone: "warning", title: `${name} needs review`, detail: s.reasons[0] ?? "Check the details before sharing.", href, cta: "Review" });
    if (s.status === "ready") out.push({ key: `st-${s.id}`, tone: "teal", title: `We found a new ${name} bill`, detail: `${s.amount_cents !== null ? formatUSD(s.amount_cents) : ""}${s.due_date ? ` · due ${formatDate(s.due_date)}` : ""}. Check the details before sharing.`, href, cta: "Confirm" });
    if (s.status === "needs_statement") out.push({ key: `st-${s.id}`, tone: "warning", title: "Statement details needed", detail: `We received a ${name} notification, but not the amount or due date. Upload the statement to continue.`, href: `/s/${spaceId}/auto-bills`, cta: "Upload" });
    if (s.status === "failed") out.push({ key: `st-${s.id}`, tone: "error", title: "We couldn't read a statement", detail: s.file_name ?? "Try a different PDF, or enter the bill yourself.", href, cta: "Open" });
  }

  for (const m of missingStatements(statements, today))
    out.push({ key: `miss-${m.provider}`, tone: "warning", title: `We haven't received this month's ${m.provider} bill`, detail: "That doesn't mean it's paid. Check your email or the provider's site, then upload it.", href: `/s/${spaceId}/auto-bills`, cta: "Upload" });

  const rank = { error: 0, warning: 1, teal: 2 };
  return out.sort((a, b) => rank[a.tone] - rank[b.tone]);
}
