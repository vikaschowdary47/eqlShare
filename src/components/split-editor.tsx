"use client";

import { useMemo, useState } from "react";
import { centsToInput, formatUSD, parseDollars } from "@/lib/domain/money";
import { percentToBps, splitBill, type ShareInput, type SplitMethod } from "@/lib/domain/split";
import { Avatar, ShareBar, cx } from "./ui";

export interface SplitMember { id: string; name: string; isMe: boolean }

export function useSplit(members: SplitMember[], totalCents: number | null, defaultMethod: SplitMethod) {
  const [method, setMethod] = useState<SplitMethod>(defaultMethod);
  const [selected, setSelected] = useState<string[]>(members.map((m) => m.id));
  const [values, setValues] = useState<Record<string, string>>({});

  const participants = members.filter((m) => selected.includes(m.id));
  const inputs: ShareInput[] = participants.map((m) => {
    if (method === "equal") return { memberId: m.id };
    const raw = values[m.id] ?? "";
    const v = method === "exact" ? parseDollars(raw || "0") : percentToBps(raw || "0");
    return { memberId: m.id, value: v ?? Number.NaN };
  });
  const result = useMemo(
    () => (totalCents && totalCents > 0 ? splitBill(totalCents, method, inputs) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [totalCents, method, JSON.stringify(inputs)],
  );
  const assigned = method === "exact" ? inputs.reduce((a, i) => a + (Number.isFinite(i.value) ? (i.value as number) : 0), 0) : null;
  const bpsAssigned = method === "percent" ? inputs.reduce((a, i) => a + (Number.isFinite(i.value) ? (i.value as number) : 0), 0) : null;

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : members.filter((m) => s.includes(m.id) || m.id === id).map((m) => m.id)));
  }
  function fillEvenly() {
    if (!totalCents) return;
    const r = splitBill(totalCents, "equal", participants.map((m) => ({ memberId: m.id })));
    if (!r.ok) return;
    if (method === "exact") setValues(Object.fromEntries(r.shares.map((s) => [s.memberId, centsToInput(s.amountCents)])));
    if (method === "percent") {
      const p = splitBill(10000, "equal", participants.map((m) => ({ memberId: m.id })));
      if (p.ok) setValues(Object.fromEntries(p.shares.map((s) => [s.memberId, (s.amountCents / 100).toFixed(2)])));
    }
  }
  return { method, setMethod, selected, toggle, values, setValues, participants, inputs, result, assigned, bpsAssigned, fillEvenly, members, totalCents };
}

export type SplitState = ReturnType<typeof useSplit>;

const METHODS: { key: SplitMethod; label: string }[] = [
  { key: "equal", label: "Equally" },
  { key: "exact", label: "Exact amounts" },
  { key: "percent", label: "Percentages" },
];

export function SplitEditor({ s, payerId }: { s: SplitState; payerId: string }) {
  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="text-[13px] font-medium text-ink-2 mb-2">Split between</legend>
        <div className="flex flex-wrap gap-2">
          {s.members.map((m) => {
            const on = s.selected.includes(m.id);
            return (
              <button key={m.id} type="button" aria-pressed={on} onClick={() => s.toggle(m.id)}
                className={cx("inline-flex items-center gap-2 h-10 pl-1.5 pr-3.5 rounded-full text-[14px] transition-all duration-200",
                  on ? "bg-ink text-white" : "bg-surface ring-1 ring-line-strong text-ink-2 hover:ring-ink/40")}>
                <Avatar name={m.name} size={28} muted={!on} />
                <span className="max-w-[160px] truncate">{m.isMe ? "You" : m.name}</span>
                {on && <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-[13px] font-medium text-ink-2 mb-2">How to split</legend>
        <div className="grid grid-cols-3 gap-1 p-1 rounded-[14px] bg-sunken ring-1 ring-line">
          {METHODS.map((m) => (
            <label key={m.key} className={cx("relative grid place-items-center h-10 rounded-[10px] text-[14px] cursor-pointer transition-all",
              s.method === m.key ? "bg-surface font-medium shadow-[0_1px_3px_rgba(11,26,24,0.12)]" : "text-ink-2 hover:text-ink")}>
              <input type="radio" name="method" value={m.key} checked={s.method === m.key} onChange={() => s.setMethod(m.key)} className="sr-only" />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>

      {s.method !== "equal" && s.participants.length > 0 && (
        <div className="space-y-2">
          {s.participants.map((m) => (
            <div key={m.id} className="flex items-center gap-3">
              <Avatar name={m.name} size={32} />
              <label htmlFor={`v-${m.id}`} className="flex-1 min-w-0 text-[15px] truncate">{m.isMe ? "You" : m.name}{m.id === payerId && <span className="text-muted"> · paid</span>}</label>
              <div className="relative w-[140px]">
                {s.method === "exact" && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true">$</span>}
                <input id={`v-${m.id}`} inputMode="decimal" autoComplete="off" value={s.values[m.id] ?? ""} placeholder={s.method === "exact" ? "0.00" : "0"}
                  onChange={(e) => s.setValues({ ...s.values, [m.id]: e.target.value.replace(/[^\d.]/g, "") })}
                  className={cx("w-full h-11 rounded-[12px] bg-surface ring-1 ring-inset ring-line-strong text-right num text-[16px] focus:outline-none focus:ring-2 focus:ring-brand-strong",
                    s.method === "exact" ? "pl-7 pr-3" : "pl-3 pr-8")} />
                {s.method === "percent" && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true">%</span>}
              </div>
            </div>
          ))}
          <button type="button" onClick={s.fillEvenly} className="text-[14px] text-brand-ink underline underline-offset-4 decoration-brand-strong/30 hover:decoration-brand-strong">Fill in evenly, then adjust</button>
        </div>
      )}
    </div>
  );
}

/** Live, cents-exact preview. The reconciliation line is the product's promise made visible. */
export function SplitPreview({ s, payerId, title }: { s: SplitState; payerId: string; title?: string }) {
  const r = s.result;
  const total = s.totalCents ?? 0;
  const names = new Map(s.members.map((m) => [m.id, m.isMe ? "You" : m.name]));
  let status: React.ReactNode = null;
  if (!total) status = <p className="text-[14px] text-muted">Enter an amount to see each share.</p>;
  else if (s.participants.length === 0) status = <p className="text-[14px] text-error">Choose at least one person.</p>;
  else if (r && !r.ok) {
    if (s.method === "exact" && s.assigned !== null) {
      const diff = total - s.assigned;
      status = <p role="status" className="text-[14px] text-warning">{diff > 0 ? `${formatUSD(diff)} left to assign` : `${formatUSD(-diff)} too much assigned`} · shares must add up to {formatUSD(total)}</p>;
    } else if (s.method === "percent" && s.bpsAssigned !== null) {
      const diff = 10000 - s.bpsAssigned;
      status = <p role="status" className="text-[14px] text-warning">{diff > 0 ? `${(diff / 100).toFixed(2)}% left to assign` : `${(-diff / 100).toFixed(2)}% over 100%`}</p>;
    } else status = <p role="status" className="text-[14px] text-warning">{r.error}</p>;
  }

  return (
    <div className="rounded-[20px] bg-surface ring-1 ring-line p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[14px] font-medium truncate">{title || "Preview"}</p>
        <p className="figure text-[26px]">{total ? formatUSD(total) : "$0.00"}</p>
      </div>
      {r?.ok ? (
        <>
          <ShareBar className="mt-4" parts={r.shares.map((x) => ({ key: x.memberId, cents: x.amountCents, state: x.memberId === payerId ? "own" : "open" }))} />
          <ul className="mt-4 divide-y divide-line">
            {r.shares.map((x) => (
              <li key={x.memberId} className="flex items-center justify-between py-2.5 text-[15px]">
                <span className="truncate">{names.get(x.memberId)}{x.memberId === payerId ? <span className="text-muted"> · paid upfront</span> : <span className="text-muted"> · owes</span>}</span>
                <span className="num font-medium">{formatUSD(x.amountCents)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex items-start gap-2 text-[13px] text-success">
            <svg width="14" height="14" viewBox="0 0 24 24" className="mt-0.5 shrink-0" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>Every cent assigned: {r.shares.map((x) => formatUSD(x.amountCents)).join(" + ")} = {formatUSD(total)}{s.method === "equal" && total % r.shares.length !== 0 ? ". Leftover cents go to the first people listed." : ""}</span>
          </p>
        </>
      ) : <div className="mt-4">{status}</div>}
    </div>
  );
}
