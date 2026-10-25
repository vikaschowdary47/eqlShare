import Link from "next/link";
import type { Metadata } from "next";
import { getProfile, getSpaceContext, getStatements } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { signOutAction } from "@/lib/actions";
import { Card, buttonClass } from "@/components/ui";
import { DisplayName, Invites, Members, Notifications, SpaceDetails } from "@/components/space-settings";
import { ImportBanner } from "@/components/import/import-banner";

export const metadata: Metadata = { title: "Space" };

function Section({ id, title, desc, children }: { id: string; title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4 lg:gap-10 py-8 border-t border-line first:border-t-0 first:pt-0 scroll-mt-24">
      <div><h2 id={`${id}-h`} className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>{desc && <p className="text-[14px] text-muted mt-1">{desc}</p>}</div>
      <Card className="p-5 sm:p-6 min-w-0">{children}</Card>
    </section>
  );
}

export default async function SpacePage({ params, searchParams }: { params: Promise<{ spaceId: string }>; searchParams: Promise<{ import?: string }> }) {
  const { spaceId } = await params;
  const { import: batchId } = await searchParams;
  const ctx = (await getSpaceContext(spaceId))!;
  const isOwner = ctx.me?.role === "owner";
  const supabase = await supabaseServer();
  const [{ data: invites }, { data: prefs }, statements, profile] = await Promise.all([
    isOwner ? supabase.from("space_invitations").select("id, expires_at, use_count, max_uses, revoked_at").eq("space_id", spaceId).is("revoked_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }) : Promise.resolve({ data: [] }),
    supabase.from("notification_prefs").select("bill_arrival, reminder_days, reminders_opt_out").eq("space_id", spaceId).maybeSingle(),
    getStatements(spaceId),
    getProfile(),
  ]);
  const sources = new Set(statements.filter((s) => s.provider).map((s) => s.provider));

  return (
    <div className="max-w-[980px]">
      <header className="mb-8 rise">
        <h1 className="text-[clamp(28px,5vw,40px)] font-semibold tracking-[-0.04em] leading-tight">Space</h1>
        <p className="text-muted mt-1">{ctx.space.name} · {ctx.active.length} {ctx.active.length === 1 ? "member" : "members"}</p>
      </header>

      {batchId && /^[0-9a-f-]{36}$/.test(batchId) && <ImportBanner batchId={batchId} />}

      <Section id="members" title="Members" desc="People who can see this Space's bills.">
        <Members spaceId={spaceId} spaceName={ctx.space.name} meId={ctx.me?.id ?? null} isOwner={!!isOwner}
          members={ctx.members.map((m) => ({ id: m.id, name: m.name, role: m.role, status: m.status, joined: m.joined_at, left: m.left_at, placeholder: m.placeholder }))} />
      </Section>

      {isOwner && (
        <Section id="invite" title="Invite people" desc="Share a private link. Anyone with it can ask to join.">
          <Invites spaceId={spaceId} spaceName={ctx.space.name} invites={(invites ?? []) as { id: string; expires_at: string; use_count: number; max_uses: number }[]} />
        </Section>
      )}

      <Section id="settings" title="Space settings" desc="Name, type and the default split for new bills.">
        <SpaceDetails spaceId={spaceId} name={ctx.space.name} type={ctx.space.type} defaultSplit={ctx.space.default_split} canEdit={!!isOwner} />
      </Section>

      {ctx.me && (
        <Section id="import" title="Import from Splitwise" desc="Bring over balances from a few screenshots.">
          <p className="text-[15px] text-ink-2">Open each Splitwise group, tap Balances and take a screenshot. Only balances come over, and the people in them get personal invite links.</p>
          <Link href={`/import?from=${spaceId}`} className={buttonClass("secondary", "sm") + " mt-4"}>Import from Splitwise</Link>
        </Section>
      )}

      <Section id="sources" title="Bill sources" desc="Where Auto Bills get statements from.">
        <p className="text-[15px]">{sources.size ? `Statements received from ${[...sources].join(", ")}.` : "No statements received yet."}</p>
        <Link href={`/s/${spaceId}/auto-bills`} className={buttonClass("secondary", "sm") + " mt-4"}>Manage Auto Bills</Link>
      </Section>

      {ctx.me && (
        <Section id="notifications" title="Notifications" desc="Only for you, in this Space.">
          <Notifications spaceId={spaceId} prefs={prefs ?? { bill_arrival: true, reminder_days: [5, 2, 1], reminders_opt_out: false }} />
        </Section>
      )}

      <Section id="export" title="Export" desc="Your records belong to you.">
        <p className="text-[15px] text-ink-2">Download every bill, share and payment in this Space as a spreadsheet file (CSV).</p>
        <a href={`/s/${spaceId}/export`} className={buttonClass("secondary", "sm") + " mt-4"} download>Download CSV</a>
      </Section>

      <Section id="account" title="Your account">
        <div className="space-y-5">
          {ctx.me && <DisplayName spaceId={spaceId} name={profile?.display_name ?? ""} />}
          <form action={signOutAction}><button className={buttonClass("ghost", "sm")}>Sign out</button></form>
        </div>
      </Section>
    </div>
  );
}
