"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { claimMemberAction } from "@/lib/actions";
import { Button, Notice } from "./ui";

export function AcceptClaim({ token, name }: { token: string; name: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      {error && <Notice tone="error" title={error} />}
      <Button size="lg" full loading={pending} onClick={() => start(async () => { const r = await claimMemberAction(token); if (r && !r.ok) setError(r.error); })}>
        I'm {name.split(" ")[0] || "this person"}, join
      </Button>
      <Link href="/home" className="block text-center text-[15px] text-ink-2 py-2 hover:text-ink">Not me</Link>
    </div>
  );
}
