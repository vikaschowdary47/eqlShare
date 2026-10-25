"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { dismissNotificationsAction } from "@/lib/actions";
import { Button, Notice } from "./ui";

type Note = { id: number; kind: string; payload: Record<string, unknown> };

function text(n: Note) {
  if (n.kind === "person_claimed") {
    const count = Number(n.payload.space_count) || 1;
    const name = String(n.payload.name ?? "Someone");
    const as = n.payload.imported_as && n.payload.imported_as !== n.payload.name ? ` (imported as ${n.payload.imported_as})` : "";
    return `${name}${as} joined ${count === 1 ? "1 Space" : `${count} Spaces`}`;
  }
  return null;
}

/** Cross-Space notifications for the viewer, plus a welcome after claiming an invite. */
export function TopNotices({ notes, claimed }: { notes: Note[]; claimed: number }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [pending, start] = useTransition();
  const shown = notes.filter((n) => text(n));
  if (hidden || (!shown.length && !claimed)) return null;
  return (
    <div className="space-y-3">
      {claimed > 0 && (
        <Notice tone="success" title={claimed === 1 ? "You joined this Space" : `You joined ${claimed} Spaces`}>
          Your imported balances are here. Switch Spaces from the menu at the top.
        </Notice>
      )}
      {shown.length > 0 && (
        <Notice tone="teal" title={shown.length === 1 ? text(shown[0])! : `${shown.length} people joined`}
          action={<Button size="sm" variant="secondary" loading={pending} onClick={() => start(async () => { await dismissNotificationsAction(shown.map((n) => n.id)); setHidden(true); router.refresh(); })}>Dismiss</Button>}>
          {shown.length > 1 ? shown.map((n) => text(n)).join(" · ") : "Their balances are now connected to their own account."}
        </Notice>
      )}
    </div>
  );
}
