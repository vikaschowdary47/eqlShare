import { getBills, getSpaceContext } from "@/lib/data";

/** Prevent spreadsheet formula injection, then CSV-quote. */
function cell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(_: Request, { params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;
  const ctx = await getSpaceContext(spaceId);
  if (!ctx) return new Response("Not found", { status: 404 });
  const bills = await getBills(spaceId, ctx, { includeVoid: true });
  const rows: unknown[][] = [["bill_id", "title", "category", "bill_status", "total_usd", "bill_date", "due_date", "period_start", "period_end", "paid_upfront_by", "member", "share_usd", "confirmed_usd", "reported_pending_usd", "outstanding_usd", "share_disputed"]];
  const usd = (c: number) => (c / 100).toFixed(2);
  for (const b of bills)
    for (const s of b.splits)
      rows.push([b.id, b.title, b.category, b.status, usd(b.amount_cents), b.bill_date, b.due_date, b.period_start, b.period_end, b.payer.name, s.member.name,
        usd(s.amount_cents), usd(s.position.confirmedCents), usd(s.position.pendingCents), usd(s.position.outstandingCents), s.disputed_at ? "yes" : "no"]);
  const csv = rows.map((r) => r.map(cell).join(",")).join("\r\n");
  const name = ctx.space.name.replace(/[^\w-]+/g, "-").toLowerCase();
  return new Response(csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="eqlshare-${name}-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" },
  });
}
