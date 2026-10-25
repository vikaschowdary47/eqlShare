import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { splitPosition, type SettlementStatus, type SplitPosition } from "@/lib/domain/balances";
import { dueState, todayISO, type DueState } from "@/lib/domain/due";
import type { SpaceType } from "@/lib/domain/spaces";
import type { SplitMethod } from "@/lib/domain/split";

export type Role = "owner" | "member";

export interface Space {
  id: string; name: string; type: SpaceType; currency: "USD"; default_split: SplitMethod; inbound_token: string; created_at: string;
}
export interface Member {
  id: string; user_id: string | null; role: Role; status: "active" | "inactive"; joined_at: string; left_at: string | null; name: string;
  /** Imported from Splitwise and not yet claimed by a real account. */
  placeholder: boolean; import_batch_id: string | null;
}
export interface Settlement {
  id: string; amount_cents: number; status: SettlementStatus; method: string | null; note: string | null;
  reported_at: string; confirmed_at: string | null; reported_by: string;
}
export interface SplitView {
  id: string; member: Member; amount_cents: number; disputed_at: string | null; dispute_note: string | null;
  settlements: Settlement[]; position: SplitPosition;
}
export type UtilityStatus = "not_applicable" | "unpaid" | "payment_reported" | "provider_verified";
export interface BillView {
  id: string; title: string; category: string; amount_cents: number; bill_date: string; due_date: string | null;
  period_start: string | null; period_end: string | null; split_method: SplitMethod; source: "manual" | "upload" | "email" | "import";
  import_batch_id: string | null;
  statement_id: string | null; utility_status: UtilityStatus; status: "published" | "void"; note: string | null;
  version: number; created_at: string; payer: Member; splits: SplitView[];
  /** Still owed to the payer by others (confirmed payments only). */
  outstandingCents: number;
  pendingCents: number;
  mine: SplitView | null;
  /** From my point of view: my unpaid share, or what others still owe me if I paid. */
  myDue: DueState;
  overall: DueState;
  disputed: boolean;
}
export interface Statement {
  id: string; source: "upload" | "email"; file_path: string | null; file_name: string | null; sender: string | null;
  kind: "statement" | "notice_only" | "unreadable"; provider: string | null; amount_cents: number | null; due_date: string | null;
  period_start: string | null; period_end: string | null; account_last4: string | null; statement_ref: string | null;
  reasons: string[]; parser_version: string; status: "ready" | "needs_review" | "needs_statement" | "duplicate" | "failed" | "published" | "rejected";
  revision_of: string | null; bill_id: string | null; received_at: string;
}
export interface ActivityItem {
  id: number; actor_user_id: string | null; entity_type: string; entity_id: string | null; action: string;
  metadata: Record<string, unknown>; created_at: string;
}

export const getUser = cache(async () => {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  return data.user;
});

export async function requireUser(next = "/home") {
  const user = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

export const getProfile = cache(async () => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await supabaseServer();
  const { data } = await supabase.from("profiles").select("id, display_name").eq("id", user.id).single();
  return data as { id: string; display_name: string } | null;
});

export const getMySpaces = cache(async () => {
  const user = await getUser();
  if (!user) return [];
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("space_members")
    .select("role, status, spaces(id, name, type)")
    .eq("user_id", user.id)
    .eq("status", "active")
    .order("joined_at");
  return (data ?? []).flatMap((r) => {
    const s = r.spaces as unknown as Pick<Space, "id" | "name" | "type"> | null;
    return s ? [{ ...s, role: r.role as Role }] : [];
  });
});

/** Space, its members, and the viewer's membership. Null when the viewer was never a member. */
export const getSpaceContext = cache(async (spaceId: string) => {
  const user = await getUser();
  if (!user || !/^[0-9a-f-]{36}$/i.test(spaceId)) return null;
  const supabase = await supabaseServer();
  const [{ data: space }, { data: rows }] = await Promise.all([
    supabase.from("spaces").select("id, name, type, currency, default_split, inbound_token, created_at").eq("id", spaceId).maybeSingle(),
    supabase.from("space_members").select("id, user_id, display_name, role, status, joined_at, left_at, import_batch_id").eq("space_id", spaceId).order("joined_at"),
  ]);
  if (!space || !rows) return null;
  const userIds = rows.map((r) => r.user_id).filter((u): u is string => !!u);
  const { data: profiles } = userIds.length ? await supabase.from("profiles").select("id, display_name").in("id", userIds) : { data: [] };
  const names = new Map((profiles ?? []).map((p) => [p.id, p.display_name as string]));
  const members: Member[] = rows.map((r) => ({
    id: r.id, user_id: r.user_id, role: r.role, status: r.status, joined_at: r.joined_at, left_at: r.left_at, import_batch_id: r.import_batch_id,
    placeholder: r.user_id === null,
    name: r.user_id ? names.get(r.user_id) ?? r.display_name ?? "Former member" : r.display_name ?? "Unnamed",
  }));
  const me = members.find((m) => m.user_id === user.id && m.status === "active") ?? null;
  const formerMe = members.find((m) => m.user_id === user.id) ?? null;
  return { space: space as Space, members, me, formerMe, active: members.filter((m) => m.status === "active"), userId: user.id };
});

export type SpaceContext = NonNullable<Awaited<ReturnType<typeof getSpaceContext>>>;

export async function requireSpace(spaceId: string) {
  const ctx = await getSpaceContext(spaceId);
  return ctx;
}

export const getBills = cache(async (spaceId: string, ctx: SpaceContext, opts: { includeVoid?: boolean } = {}) => {
  const supabase = await supabaseServer();
  let q = supabase
    .from("bills")
    .select("id, title, category, amount_cents, bill_date, due_date, period_start, period_end, split_method, source, statement_id, import_batch_id, utility_status, status, note, version, created_at, payer_member_id, bill_splits(id, member_id, amount_cents, disputed_at, dispute_note, settlements(id, amount_cents, status, method, note, reported_at, confirmed_at, reported_by))")
    .eq("space_id", spaceId)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (!opts.includeVoid) q = q.eq("status", "published");
  const { data, error } = await q;
  if (error) throw new Error("Could not load bills");
  const byId = new Map(ctx.members.map((m) => [m.id, m]));
  const meId = ctx.formerMe?.id ?? null;
  const today = todayISO();

  return (data ?? []).map((b): BillView => {
    const payer = byId.get(b.payer_member_id)!;
    const splits: SplitView[] = (b.bill_splits ?? []).map((s) => {
      const settlements = (s.settlements ?? []) as Settlement[];
      return {
        id: s.id, member: byId.get(s.member_id)!, amount_cents: s.amount_cents, disputed_at: s.disputed_at, dispute_note: s.dispute_note,
        settlements: settlements.sort((x, y) => x.reported_at.localeCompare(y.reported_at)),
        position: splitPosition({ id: s.id, memberId: s.member_id, payerMemberId: b.payer_member_id, amountCents: s.amount_cents, settlements: settlements.map((x) => ({ amountCents: x.amount_cents, status: x.status })) }),
      };
    }).sort((x, y) => x.member.joined_at.localeCompare(y.member.joined_at));
    const outstandingCents = splits.reduce((a, s) => a + s.position.outstandingCents, 0);
    const pendingCents = splits.reduce((a, s) => a + s.position.pendingCents, 0);
    const mine = splits.find((s) => s.member.id === meId) ?? null;
    const myOutstanding = payer.id === meId ? outstandingCents : mine?.position.outstandingCents ?? 0;
    return {
      id: b.id, title: b.title, category: b.category, amount_cents: b.amount_cents, bill_date: b.bill_date, due_date: b.due_date,
      period_start: b.period_start, period_end: b.period_end, split_method: b.split_method, source: b.source, statement_id: b.statement_id,
      utility_status: b.utility_status, status: b.status, note: b.note, version: b.version, created_at: b.created_at, import_batch_id: b.import_batch_id,
      payer, splits, outstandingCents, pendingCents, mine,
      myDue: dueState(b.due_date, myOutstanding, today),
      overall: dueState(b.due_date, outstandingCents, today),
      disputed: splits.some((s) => s.disputed_at || s.position.disputed),
    };
  });
});

export async function getStatements(spaceId: string) {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("statements")
    .select("id, source, file_path, file_name, sender, kind, provider, amount_cents, due_date, period_start, period_end, account_last4, statement_ref, reasons, parser_version, status, revision_of, bill_id, received_at")
    .eq("space_id", spaceId)
    .order("received_at", { ascending: false })
    .limit(100);
  return (data ?? []) as Statement[];
}

export async function getActivity(spaceId: string, limit = 50) {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("activity")
    .select("id, actor_user_id, entity_type, entity_id, action, metadata, created_at")
    .eq("space_id", spaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as ActivityItem[];
}

export { missingStatements } from "./data-pure";

/** Spaces the viewer owns, with their other active members, for "Add to existing Space" in the import review. */
export async function getOwnedSpacesWithMembers() {
  const user = await getUser();
  if (!user) return [];
  const spaces = (await getMySpaces()).filter((s) => s.role === "owner");
  const out: { id: string; name: string; members: { id: string; name: string; isMe: boolean }[] }[] = [];
  for (const s of spaces) {
    const ctx = await getSpaceContext(s.id);
    if (!ctx) continue;
    out.push({ id: s.id, name: s.name, members: ctx.active.map((m) => ({ id: m.id, name: m.placeholder ? `${m.name} (not joined)` : m.name, isMe: m.user_id === user.id })) });
  }
  return out;
}
