import Link from "next/link";
import type { Metadata } from "next";
import { getUser } from "@/lib/data";
import { supabaseServer } from "@/lib/supabase/server";
import { SPACE_PRESETS, type SpaceType } from "@/lib/domain/spaces";
import { ButtonLink, Logo, EqualsArt } from "@/components/ui";
import { AcceptInvite } from "@/components/accept-invite";

export const metadata: Metadata = { title: "Join a Space", robots: { index: false } };

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const user = await getUser();
  const here = `/join/${token}`;

  let body: React.ReactNode;
  if (!user) {
    body = (
      <>
        <h1 className="text-[32px] font-semibold tracking-[-0.035em] leading-tight">You've been invited to a Space</h1>
        <p className="text-muted mt-3">Sign in or create a free account to see who invited you and join.</p>
        <div className="mt-8 grid gap-3">
          <ButtonLink href={`/signup?next=${encodeURIComponent(here)}`} size="lg" full>Create account</ButtonLink>
          <ButtonLink href={`/login?next=${encodeURIComponent(here)}`} size="lg" variant="secondary" full>Sign in</ButtonLink>
        </div>
      </>
    );
  } else {
    const supabase = await supabaseServer();
    const { data } = await supabase.rpc("preview_invitation", { p_token: token });
    const p = (data as { space_name: string | null; space_type: SpaceType | null; inviter: string | null; valid: boolean; already_member: boolean }[] | null)?.[0];
    if (!p?.valid) {
      body = (
        <>
          <EqualsArt />
          <h1 className="mt-6 text-[30px] font-semibold tracking-[-0.035em] leading-tight">This invite link doesn't work</h1>
          <p className="text-muted mt-3">It may have expired or been revoked. Ask the person who invited you to send a new link.</p>
          <ButtonLink href="/home" variant="secondary" size="lg" className="mt-8">Go to my Spaces</ButtonLink>
        </>
      );
    } else {
      body = (
        <>
          <p className="text-[13px] font-medium text-brand-ink tracking-[0.14em] uppercase">{SPACE_PRESETS[p.space_type!].label}</p>
          <h1 className="mt-2 text-[36px] font-semibold tracking-[-0.04em] leading-[1.05]">Join {p.space_name}</h1>
          <p className="text-muted mt-3"><strong className="text-ink font-medium">{p.inviter}</strong> invited you. Once you join, you'll see this Space's bills and your share of each one. Other members will see your name.</p>
          <div className="mt-8">{p.already_member ? <ButtonLink href="/home" size="lg" full>You're already a member. Open Space</ButtonLink> : <AcceptInvite token={token} />}</div>
        </>
      );
    }
  }

  return (
    <div className="min-h-dvh flex flex-col px-5 sm:px-10 py-6">
      <Link href="/" aria-label="Eqlshare home"><Logo /></Link>
      <main className="flex-1 grid place-items-center"><div className="w-full max-w-[420px] rise">{body}</div></main>
    </div>
  );
}
