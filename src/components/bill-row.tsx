import Link from "next/link";
import type { BillView } from "@/lib/data";
import { formatUSD } from "@/lib/domain/money";
import { formatDate } from "@/lib/domain/due";
import { CategoryGlyph, DueChip, ShareChip } from "./status";
import { Chip } from "./ui";

/** "Rahul owes you", "you owe Asha", or "Rahul owes Asha" for an opening balance. */
export function openingBalanceWords(bill: BillView, meId: string | null) {
  const debtor = bill.splits.find((s) => !s.position.isPayerOwnShare)?.member;
  const from = !debtor ? "Someone" : debtor.id === meId ? "you" : debtor.name.split(" ")[0];
  const to = bill.payer.id === meId ? "you" : bill.payer.name.split(" ")[0];
  return `${from} ${from === "you" ? "owe" : "owes"} ${to}`;
}

/** One line per bill: what it is, when it's due, your share, and its state from your point of view. */
export function BillRow({ bill, spaceId, meId }: { bill: BillView; spaceId: string; meId: string | null }) {
  const iPaid = bill.payer.id === meId;
  const mine = bill.mine;
  let right: React.ReactNode;
  if (bill.status === "void") right = <Chip>Voided</Chip>;
  else if (bill.source === "import" && (iPaid ? bill.outstandingCents === 0 : mine?.position.outstandingCents === 0)) right = <Chip tone="success">Settled</Chip>;
  else if (bill.source === "import" && !(mine?.position.pendingCents || mine?.position.disputed || mine?.disputed_at)) right = <Chip tone="brand">Opening balance</Chip>;
  else if (iPaid) right = bill.outstandingCents > 0 ? <DueChip state={bill.overall} dueDate={bill.due_date} /> : <Chip tone="success">All received</Chip>;
  else if (mine) right = mine.position.outstandingCents === 0 || mine.position.pendingCents > 0 || mine.position.disputed || mine.disputed_at
    ? <ShareChip position={mine.position} disputed={!!mine.disputed_at} />
    : <DueChip state={bill.myDue} dueDate={bill.due_date} />;
  else right = <Chip>Not in this split</Chip>;

  return (
    <Link href={`/s/${spaceId}/bills/${bill.id}`}
      className="group flex items-center gap-3.5 px-4 sm:px-5 py-4 hover:bg-sunken/60 focus-visible:bg-sunken/60 transition-colors">
      <CategoryGlyph category={bill.category} />
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium truncate">{bill.title}</p>
        <p className="text-[13px] text-muted truncate">
          {bill.source === "import"
            ? `Imported from Splitwise · ${openingBalanceWords(bill, meId)}`
            : <>{bill.due_date ? `Due ${formatDate(bill.due_date)}` : "No due date"} · {iPaid ? "You paid" : `${bill.payer.name.split(" ")[0]} paid`} {formatUSD(bill.amount_cents)}</>}
        </p>
      </div>
      <div className="text-right shrink-0 flex flex-col items-end gap-1">
        <span className="num text-[15px] font-semibold">
          {iPaid ? formatUSD(bill.outstandingCents) : mine ? formatUSD(mine.amount_cents) : "—"}
          <span className="sr-only">{iPaid ? " still owed to you" : " your share"}</span>
        </span>
        <span className="hidden sm:block">{right}</span>
      </div>
      <span className="sm:hidden">{right}</span>
    </Link>
  );
}
