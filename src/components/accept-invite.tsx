"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { acceptInviteAction } from "@/lib/actions";
import { Button, Notice } from "./ui";

export function AcceptInvite({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      {error && <Notice tone="error" title={error} />}
      <Button size="lg" full loading={pending} onClick={() => start(async () => { const r = await acceptInviteAction(token); if (r && !r.ok) setError(r.error); })}>Accept and join</Button>
      <Link href="/home" className="block text-center text-[15px] text-ink-2 py-2 hover:text-ink">Decline</Link>
    </div>
  );
}
