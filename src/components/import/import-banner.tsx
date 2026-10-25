import { supabaseServer } from "@/lib/supabase/server";
import { Notice } from "@/components/ui";
import { UndoImportButton } from "./undo-import";

const BLOCKER: Record<string, string> = {
  settlement_recorded: "a payment was recorded",
  new_bill_added: "a new bill includes imported people",
  placeholder_claimed: "someone has joined through their invite",
  balance_disputed: "a balance was disputed",
  member_joined: "someone joined the Space",
};

export async function ImportBanner({ batchId }: { batchId: string }) {
  const supabase = await supabaseServer();
  const { data } = await supabase.rpc("import_status_for", { p_batch: batchId });
  const s = data as { status: "applied" | "undone"; blockers: string[] | null } | null;
  if (!s || s.status !== "applied") return null;
  const blockers = s.blockers ?? [];
  return (
    <div className="mb-8">
      <Notice tone="success" title="Imported from Splitwise"
        action={blockers.length === 0 ? <UndoImportButton batchId={batchId} /> : undefined}>
        {blockers.length === 0
          ? "Your opening balances are in. Invite each person below so they can see what they owe. You can undo this import until anything else happens."
          : `This import can no longer be undone because ${blockers.map((b) => BLOCKER[b] ?? b).join(", ")}.`}
      </Notice>
    </div>
  );
}
