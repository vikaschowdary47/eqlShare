"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  confirmSettlementAction, disputeSettlementAction, disputeSplitAction, reportSettlementAction, reportUtilityPaidAction,
  resolveDisputeAction, sendReminderAction, statementFileUrlAction, updateBillDetailsAction, voidBillAction, type Result,
} from "@/lib/actions";
import { centsToInput, formatUSD, parseDollars } from "@/lib/domain/money";
import { CATEGORY_LABEL } from "./status";
import { Button, Field, Input, Notice, Select } from "./ui";
import { CopyField } from "./copy-field";
import { uuid } from "@/lib/uuid";
import { APP_NAME } from "@/lib/brand";

function useAction() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function run(fn: () => Promise<Result<unknown>>, onOk?: () => void) {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) return setError(r.error);
      onOk?.();
      router.refresh();
    });
  }
  return { error, pending, run };
}

const textarea = "block w-full rounded-[12px] bg-surface p-3 text-[15px] ring-1 ring-inset ring-line-strong focus:outline-none focus:ring-2 focus:ring-brand-strong";

/** For the member who owes: record a payment made outside the app, or dispute the share. */
export function MemberShareActions({ spaceId, splitId, reportableCents, payerFirst, disputed }: { spaceId: string; splitId: string; reportableCents: number; payerFirst: string; disputed: boolean }) {
  const [mode, setMode] = useState<"none" | "pay" | "dispute">("none");
  const [amount, setAmount] = useState(centsToInput(reportableCents));
  const [method, setMethod] = useState("");
  const [note, setNote] = useState("");
  const reqId = useRef(uuid());
  const a = useAction();
  const cents = parseDollars(amount);

  if (mode === "pay") {
    return (
      <form className="mt-3 space-y-3 rounded-[14px] bg-sunken p-4" onSubmit={(e) => { e.preventDefault(); if (cents) a.run(() => reportSettlementAction(spaceId, { splitId, amountCents: cents, method, note, clientRequestId: reqId.current }), () => setMode("none")); }}>
        <p className="text-[14px] text-ink-2">Pay {payerFirst} the way you usually do, then record it here. {payerFirst} confirms once it arrives.</p>
        {a.error && <Notice tone="error" title={a.error} />}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount" htmlFor={`amt-${splitId}`} hint={`Up to ${formatUSD(reportableCents)}`} error={cents !== null && cents > reportableCents ? "More than you owe" : null}>
            <Input id={`amt-${splitId}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
          </Field>
          <Field label="Paid with (optional)" htmlFor={`m-${splitId}`}><Input id={`m-${splitId}`} value={method} maxLength={40} placeholder="Venmo, Zelle, cash" onChange={(e) => setMethod(e.target.value)} /></Field>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={() => setMode("none")}>Cancel</Button>
          <Button type="submit" className="flex-1" loading={a.pending} disabled={!cents || cents > reportableCents}>Record {cents ? formatUSD(cents) : ""} as paid</Button>
        </div>
      </form>
    );
  }
  if (mode === "dispute") {
    return (
      <form className="mt-3 space-y-3 rounded-[14px] bg-sunken p-4" onSubmit={(e) => { e.preventDefault(); a.run(() => disputeSplitAction(spaceId, splitId, note), () => setMode("none")); }}>
        {a.error && <Notice tone="error" title={a.error} />}
        <Field label="What's wrong with this share?" htmlFor={`d-${splitId}`} hint="Nothing changes until the bill is edited. The history is kept.">
          <textarea id={`d-${splitId}`} className={textarea} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="I was away Oct 1 to 14" />
        </Field>
        <div className="flex gap-2"><Button type="button" variant="ghost" onClick={() => setMode("none")}>Cancel</Button><Button type="submit" variant="danger" className="flex-1" loading={a.pending}>Dispute my share</Button></div>
      </form>
    );
  }
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {reportableCents > 0 && <Button size="sm" onClick={() => setMode("pay")}>Record payment</Button>}
      {!disputed && <Button size="sm" variant="ghost" onClick={() => setMode("dispute")}>Dispute share</Button>}
      {a.error && <p className="text-[13px] text-error w-full">{a.error}</p>}
    </div>
  );
}

/** For the payer: confirm or reject a reported payment. */
export function ConfirmSettlement({ spaceId, settlementId, amountCents, from }: { spaceId: string; settlementId: string; amountCents: number; from: string }) {
  const a = useAction();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  if (rejecting) {
    return (
      <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); a.run(() => disputeSettlementAction(spaceId, settlementId, note)); }}>
        <label htmlFor={`r-${settlementId}`} className="text-[13px] text-ink-2">Tell {from} what's wrong (optional)</label>
        <textarea id={`r-${settlementId}`} className={textarea} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Haven't received it yet" />
        <div className="flex gap-2"><Button size="sm" variant="ghost" type="button" onClick={() => setRejecting(false)}>Cancel</Button><Button size="sm" variant="danger" loading={a.pending}>Mark not received</Button></div>
      </form>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap gap-2 items-center">
      <Button size="sm" loading={a.pending} onClick={() => a.run(() => confirmSettlementAction(spaceId, settlementId))}>Confirm {formatUSD(amountCents)} received</Button>
      <Button size="sm" variant="ghost" onClick={() => setRejecting(true)}>Not received</Button>
      {a.error && <p className="text-[13px] text-error w-full">{a.error}</p>}
    </div>
  );
}

export function RemindButton({ spaceId, splitId, message, link }: { spaceId: string; splitId: string; message: string; link: string }) {
  const a = useAction();
  const [sent, setSent] = useState(false);
  if (sent) return <div className="mt-3"><CopyField label="Reminder ready to send" value={`${message} ${link}`} shareText={`${APP_NAME} reminder`} /></div>;
  return (
    <div className="mt-2">
      <Button size="sm" variant="secondary" loading={a.pending} onClick={() => a.run(() => sendReminderAction(spaceId, splitId), () => setSent(true))}>Send reminder</Button>
      {a.error && <p className="text-[13px] text-muted mt-1.5">{a.error}</p>}
    </div>
  );
}

export function ResolveDispute({ spaceId, splitId }: { spaceId: string; splitId: string }) {
  const a = useAction();
  return <Button size="sm" variant="secondary" loading={a.pending} onClick={() => a.run(() => resolveDisputeAction(spaceId, splitId))}>Mark resolved</Button>;
}

export function UtilityPaid({ spaceId, billId }: { spaceId: string; billId: string }) {
  const a = useAction();
  const [ask, setAsk] = useState(false);
  if (!ask) return <Button size="sm" variant="secondary" onClick={() => setAsk(true)}>I paid the provider</Button>;
  return (
    <div className="space-y-2">
      <p className="text-[13px] text-ink-2">This tells the Space you paid the provider. {APP_NAME} can't see provider payments, so it shows as unverified.</p>
      <div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setAsk(false)}>Cancel</Button><Button size="sm" loading={a.pending} onClick={() => a.run(() => reportUtilityPaidAction(spaceId, billId))}>Yes, I paid it</Button></div>
      {a.error && <p className="text-[13px] text-error">{a.error}</p>}
    </div>
  );
}

export function ViewStatement({ path }: { path: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button size="sm" variant="secondary" loading={pending} onClick={() => start(async () => {
        const r = await statementFileUrlAction(path);
        if (r.ok) window.open(r.data.url, "_blank", "noopener"); else setError(r.error);
      })}>View statement</Button>
      {error && <p className="text-[13px] text-error mt-1">{error}</p>}
    </>
  );
}

export function EditBill({ spaceId, bill }: { spaceId: string; bill: { id: string; version: number; title: string; category: string; due_date: string | null; note: string | null; locked: boolean } }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(bill.title);
  const [category, setCategory] = useState(bill.category);
  const [due, setDue] = useState(bill.due_date ?? "");
  const [note, setNote] = useState(bill.note ?? "");
  const [confirmVoid, setConfirmVoid] = useState(false);
  const a = useAction();
  const router = useRouter();
  if (!open) return <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>Edit</Button>;
  return (
    <div className="fixed inset-0 z-50 grid place-items-end sm:place-items-center bg-ink/30 backdrop-blur-[2px] p-0 sm:p-6" role="dialog" aria-modal="true" aria-labelledby="edit-title"
      onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
      <form className="w-full sm:max-w-[480px] bg-surface rounded-t-[24px] sm:rounded-[24px] p-6 space-y-4 rise max-h-[90dvh] overflow-y-auto"
        onSubmit={(e) => { e.preventDefault(); a.run(() => updateBillDetailsAction(spaceId, bill.id, { version: bill.version, title, category, dueDate: due || null, note }), () => setOpen(false)); }}>
        <h2 id="edit-title" className="text-[20px] font-semibold tracking-[-0.02em]">Edit bill</h2>
        {a.error && <Notice tone="error" title={a.error} />}
        <Field label="Title" htmlFor="e-title"><Input id="e-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category" htmlFor="e-cat"><Select id="e-cat" value={category} onChange={(e) => setCategory(e.target.value)}>{Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
          <Field label="Due date" htmlFor="e-due"><Input id="e-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        </div>
        <Field label="Note" htmlFor="e-note"><textarea id="e-note" className={textarea} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <p className="text-[13px] text-muted">{bill.locked ? "The amount and shares are locked because a payment has been recorded." : "To change the amount or shares, void this bill and add it again."} Every edit is recorded in the bill's history.</p>
        <div className="flex gap-2 pt-1"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button className="flex-1" loading={a.pending}>Save changes</Button></div>
        <div className="border-t border-line pt-4">
          {confirmVoid ? (
            <div className="space-y-2">
              <p className="text-[14px] text-ink-2">Void this bill? Everyone's shares are cancelled and unconfirmed payment reports are reversed. The history is kept.</p>
              <div className="flex gap-2"><Button type="button" size="sm" variant="ghost" onClick={() => setConfirmVoid(false)}>Keep bill</Button>
                <Button type="button" size="sm" variant="danger" loading={a.pending} onClick={() => a.run(() => voidBillAction(spaceId, bill.id), () => router.push(`/s/${spaceId}/bills`))}>Void bill</Button></div>
            </div>
          ) : <button type="button" className="text-[14px] text-error hover:underline underline-offset-4" onClick={() => setConfirmVoid(true)}>Void this bill…</button>}
        </div>
      </form>
    </div>
  );
}
