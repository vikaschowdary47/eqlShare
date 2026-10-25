import Link from "next/link";
import { getMySpaces, getProfile, getSpaceContext, requireUser } from "@/lib/data";
import { SPACE_PRESETS } from "@/lib/domain/spaces";
import { signOutAction } from "@/lib/actions";
import { AddMenu, SideNav, SpaceSwitcher, TabBar } from "@/components/shell/nav";
import { Avatar, ButtonLink, Logo, Notice } from "@/components/ui";
import { RememberSpace } from "@/components/shell/remember";
import { APP_NAME } from "@/lib/brand";

export default async function SpaceLayout({ children, params }: { children: React.ReactNode; params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;
  await requireUser(`/s/${spaceId}`);
  const [ctx, spaces, profile] = await Promise.all([getSpaceContext(spaceId), getMySpaces(), getProfile()]);

  if (!ctx) {
    return (
      <main className="min-h-dvh grid place-items-center px-5">
        <div className="max-w-[420px] text-center rise">
          <Logo />
          <h1 className="mt-10 text-[30px] font-semibold tracking-[-0.035em]">You don't have access to this Space</h1>
          <p className="mt-3 text-muted">It may not exist, or you aren't a member. Ask a member to send you an invite link.</p>
          <ButtonLink href="/home" size="lg" className="mt-8">Go to my Spaces</ButtonLink>
        </div>
      </main>
    );
  }

  const label = (t: keyof typeof SPACE_PRESETS) => SPACE_PRESETS[t].label;
  const current = { id: ctx.space.id, name: ctx.space.name, typeLabel: label(ctx.space.type) };
  const list = spaces.map((s) => ({ id: s.id, name: s.name, typeLabel: label(s.type) }));
  if (!list.some((s) => s.id === current.id)) list.unshift(current);
  const name = profile?.display_name ?? "You";
  const readOnly = !ctx.me;

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <a href="#content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:bg-ink focus:text-white focus:px-4 focus:py-2 focus:rounded-lg">Skip to content</a>
      {ctx.me && <RememberSpace spaceId={spaceId} />}

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col gap-6 sticky top-0 h-dvh px-4 py-5 border-r border-line bg-ground">
        <Link href="/home" className="px-2" aria-label={`${APP_NAME} home`}><Logo /></Link>
        <div className="px-2"><SpaceSwitcher current={current} spaces={list} /></div>
        {!readOnly && <AddMenu spaceId={spaceId} />}
        <SideNav spaceId={spaceId} />
        <div className="mt-auto flex items-center gap-3 px-2">
          <Avatar name={name} size={34} />
          <div className="min-w-0 flex-1"><p className="text-[14px] font-medium truncate">{name}</p><p className="text-[12px] text-muted capitalize">{ctx.me?.role ?? "Former member"}</p></div>
          <form action={signOutAction}><button className="h-8 px-2.5 rounded-lg text-[13px] text-ink-2 hover:bg-surface hover:text-ink">Sign out</button></form>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="lg:hidden sticky top-0 z-30 bg-ground/85 backdrop-blur-xl border-b border-line/70">
        <div className="flex items-center gap-2 h-16 px-4">
          <div className="flex-1 min-w-0"><SpaceSwitcher current={current} spaces={list} /></div>
          <Link href={`/s/${spaceId}/activity`} className="grid place-items-center size-10 rounded-full hover:bg-surface" aria-label="Notifications and activity">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></svg>
          </Link>
        </div>
      </header>

      <main id="content" className="min-w-0 px-4 sm:px-8 lg:px-12 pt-6 lg:pt-10 pb-[calc(96px+env(safe-area-inset-bottom))] lg:pb-16">
        <div className="mx-auto max-w-[1080px]">
          {readOnly && (
            <div className="mb-6"><Notice tone="warning" title="You've left this Space">You can still view history and settle shares you owed. You can't add new bills.</Notice></div>
          )}
          {children}
        </div>
      </main>
      {!readOnly && <TabBar spaceId={spaceId} />}
    </div>
  );
}
