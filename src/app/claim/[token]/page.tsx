import { createHash } from "node:crypto";
import { headers } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import { getUser } from "@/lib/data";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { formatUSD } from "@/lib/domain/money";
import { ButtonLink, EqualsArt, Logo, Money } from "@/components/ui";
import { AcceptClaim } from "@/components/accept-claim";
import { APP_NAME } from "@/lib/brand";

export const metadata: Metadata = { title: "Join your Space", robots: { index: false } };

type Preview = { valid: boolean; inviter_name: string | null; person_name: string | null; spaces: { name: string; net_cents: number }[] | null; rate_limited: boolean };
const NONE: Preview = { valid: false, inviter_name: null, person_name: null, spaces: null, rate_limited: false };

/** Only the inviter's name, this person's name, and this person's own balance in each of their Spaces. */
async function preview(token: string): Promise<Preview> {
  const admin = supabaseAdmin();
  if (!admin || !/^[0-9a-f]{64}$/.test(token)) return NONE;
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  // Hash so raw IPs are never stored
  const clientKey = createHash("sha256").update(`${ip}|${process.env.SUPABASE_SERVICE_ROLE_KEY}`).digest("hex");
  const { data } = await admin.rpc("preview_person_claim", { p_token: token, p_client_key: clientKey });
  return ((data as Preview[] | null)?.[0]) ?? NONE;
}

export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [p, user] = await Promise.all([preview(token), getUser()]);
  const here = `/claim/${token}`;

  let body: React.ReactNode;
  if (p.rate_limited) {
    body = <><h1 className="text-[30px] font-semibold tracking-[-0.035em]">Too many attempts</h1><p className="text-muted mt-3">Please wait a few minutes and open the link again.</p></>;
  } else if (!p.valid) {
    body = (
      <>
        <EqualsArt />
        <h1 className="mt-6 text-[30px] font-semibold tracking-[-0.035em] leading-tight">This invite link doesn't work</h1>
        <p className="text-muted mt-3">It may have expired, been used already, or been replaced by a newer link. Ask the person who invited you to send a new one.</p>
        <ButtonLink href={user ? "/home" : "/"} variant="secondary" size="lg" className="mt-8">{user ? "Go to my Spaces" : `Go to ${APP_NAME}`}</ButtonLink>
      </>
    );
  } else {
    const spaces = p.spaces ?? [];
    const total = spaces.reduce((a, x) => a + x.net_cents, 0);
    const inviter = p.inviter_name?.split(" ")[0] ?? "Someone";
    body = (
      <>
        <p className="text-[13px] font-medium text-brand-ink tracking-[0.14em] uppercase">You're invited</p>
        <h1 className="mt-2 text-[34px] font-semibold tracking-[-0.04em] leading-[1.05]">{inviter} invited you to {APP_NAME}</h1>
        <p className="text-muted mt-3">Your balances with {inviter} were brought over from Splitwise as <strong className="text-ink font-medium">{p.person_name}</strong>.</p>
        <div className="mt-6 rounded-[20px] bg-night text-white p-6 grain relative overflow-hidden">
          <p className="text-[14px] text-white/65">{total < 0 ? `You owe ${inviter}` : total > 0 ? `${inviter} owes you` : "Your balance"}</p>
          <Money cents={Math.abs(total)} size="lg" className="block mt-1 text-white" />
          <ul className="mt-4 space-y-1.5 text-[14px]">
            {spaces.map((x) => (
              <li key={x.name} className="flex justify-between gap-3"><span className="text-white/80 truncate">{x.name}</span><span className="num">{x.net_cents < 0 ? "you owe " : x.net_cents > 0 ? "owed to you " : ""}{formatUSD(Math.abs(x.net_cents))}</span></li>
            ))}
          </ul>
          <p className="mt-4 text-[13px] text-white/60">Opening balances imported from Splitwise. If one is wrong, you can dispute it after you join.</p>
        </div>
        <div className="mt-8">
          {user ? <AcceptClaim token={token} name={p.person_name ?? ""} count={spaces.length} /> : (
            <div className="grid gap-3">
              <ButtonLink href={`/signup?next=${encodeURIComponent(here)}`} size="lg" full>Create account to join</ButtonLink>
              <ButtonLink href={`/login?next=${encodeURIComponent(here)}`} size="lg" variant="secondary" full>I have an account</ButtonLink>
            </div>
          )}
        </div>
        <p className="mt-6 text-[13px] text-muted">No bank account needed. {APP_NAME} never moves money. This link works once.</p>
      </>
    );
  }
  return (
    <div className="min-h-dvh flex flex-col px-5 sm:px-10 py-6">
      <Link href="/" aria-label={`${APP_NAME} home`}><Logo /></Link>
      <main className="flex-1 grid place-items-center py-10"><div className="w-full max-w-[420px] rise">{body}</div></main>
    </div>
  );
}
