import Link from "next/link";
import type { ActivityItem, Member } from "@/lib/data";
import { formatUSD } from "@/lib/domain/money";
import { SPACE_PRESETS, type SpaceType } from "@/lib/domain/spaces";
import { Avatar } from "./ui";
import { APP_NAME } from "@/lib/brand";

function describe(a: ActivityItem, who: string): string {
  const m = a.metadata as Record<string, string | number | boolean | null>;
  const title = m.title ? `“${m.title}”` : "a bill";
  const amt = typeof m.amount_cents === "number" ? formatUSD(m.amount_cents) : "";
  switch (a.action) {
    case "space_created": return `${who} created this Space`;
    case "space_updated": return m.type_from !== m.type_to ? `${who} changed the Space type to ${SPACE_PRESETS[m.type_to as SpaceType]?.label ?? m.type_to}` : `${who} updated Space settings`;
    case "invite_created": return `${who} created an invite link`;
    case "invite_revoked": return `${who} revoked an invite link`;
    case "member_joined": return `${who} joined the Space`;
    case "member_left": return `${who} left the Space`;
    case "member_removed": return `${who} removed a member`;
    case "role_changed": return `${who} changed a member's role`;
    case "bill_created": return `${who} added ${title}`;
    case "bill_edited": return m.amount_from !== m.amount_to ? `${who} changed ${title} from ${formatUSD(Number(m.amount_from))} to ${formatUSD(Number(m.amount_to))}` : `${who} edited a bill`;
    case "bill_voided": return `${who} voided ${title}`;
    case "utility_payment_reported": return `${who} reported paying the provider for ${title}`;
    case "split_disputed": return `${who} disputed their share of ${title}`;
    case "split_dispute_resolved": return `${who} resolved a dispute on ${title}`;
    case "payment_reported": return `${who} reported paying ${amt} for ${title}`;
    case "payment_confirmed": return `${who} confirmed receiving ${amt} for ${title}`;
    case "payment_disputed": return `${who} disputed a reported payment for ${title}`;
    case "reminder_sent": return `${who} sent a reminder for ${title}`;
    case "statement_received": return `${m.provider ? `${m.provider} statement` : "A statement"} arrived${m.source === "email" ? " by email" : ""}`;
    case "statement_published": return `${who} shared ${m.provider ? `the ${m.provider} statement` : "a statement"} as a bill`;
    case "statement_dismissed": return `${who} dismissed ${m.provider ? `a ${m.provider} statement` : "a statement"}`;
    case "opening_balances_imported": return `${who} imported ${m.count} opening ${m.count === 1 ? "balance" : "balances"} from Splitwise`;
    case "import_undone": return `${who} undid a Splitwise import`;
    case "placeholder_added": return `${who} added ${m.name ? `“${m.name}”` : "someone"}, who hasn't joined yet`;
    case "claim_link_created": return `${who} created an invite link for someone who hasn't joined`;
    case "placeholder_claimed": return `${who} joined and took over ${m.name ? `“${m.name}”` : "an imported member"}`;
    default: return `${who} made a change`;
  }
}

function ago(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ActivityList({ items, members, meUserId, spaceId }: { items: ActivityItem[]; members: Member[]; meUserId: string; spaceId: string }) {
  const names = new Map(members.map((m) => [m.user_id, m.name]));
  return (
    <ol className="divide-y divide-line">
      {items.map((a) => {
        const who = a.actor_user_id === meUserId ? "You" : a.actor_user_id ? names.get(a.actor_user_id) ?? "Someone" : APP_NAME;
        const billId = a.entity_type === "bill" ? a.entity_id : (a.metadata.bill_id as string | undefined);
        const href = billId ? `/s/${spaceId}/bills/${billId}` : a.entity_type === "statement" && a.entity_id ? `/s/${spaceId}/auto-bills/${a.entity_id}` : null;
        const body = (
          <>
            {a.actor_user_id ? <Avatar name={who === "You" ? names.get(meUserId) ?? "You" : who} size={30} /> :
              <span className="grid place-items-center size-[30px] rounded-full bg-brand-wash text-brand-ink text-[13px] font-semibold" aria-hidden="true">=</span>}
            <p className="flex-1 min-w-0 text-[14px] text-ink-2"><span className="text-ink">{describe(a, who)}</span></p>
            <time dateTime={a.created_at} className="text-[12px] text-muted shrink-0">{ago(a.created_at)}</time>
          </>
        );
        return (
          <li key={a.id}>
            {href ? <Link href={href} className="flex items-center gap-3 px-4 sm:px-5 py-3.5 hover:bg-sunken/60">{body}</Link>
              : <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5">{body}</div>}
          </li>
        );
      })}
    </ol>
  );
}
