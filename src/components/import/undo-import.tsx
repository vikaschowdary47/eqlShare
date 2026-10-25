"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { undoImportAction } from "@/lib/actions";
import { Button } from "@/components/ui";

export function UndoImportButton({ batchId }: { batchId: string }) {
  const router = useRouter();
  const [ask, setAsk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!ask) return <Button size="sm" variant="secondary" onClick={() => setAsk(true)}>Undo this import</Button>;
  return (
    <div className="space-y-2">
      <p className="text-[14px] text-ink-2">This removes the imported balances and the people who haven't joined. Spaces created by this import are deleted.</p>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" onClick={() => setAsk(false)}>Keep import</Button>
        <Button size="sm" variant="danger" loading={pending} onClick={() => start(async () => {
          const r = await undoImportAction(batchId);
          if (!r.ok) return setError(r.error);
          router.push("/home");
        })}>Undo import</Button>
      </div>
      {error && <p className="text-[13px] text-error">{error}</p>}
    </div>
  );
}
