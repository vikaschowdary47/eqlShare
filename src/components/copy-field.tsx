"use client";

import { useState } from "react";
import { Button, cx } from "./ui";

export function CopyField({ value, label, shareText, mono }: { value: string; label: string; shareText?: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && "share" in navigator && !!shareText;
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div>
      <p className="text-[13px] font-medium text-ink-2 mb-1.5">{label}</p>
      <div className="flex items-center gap-2 rounded-[14px] bg-surface ring-1 ring-line-strong p-1.5 pl-4">
        <code className={cx("flex-1 min-w-0 truncate text-[14px] text-ink", mono ? "font-mono" : "font-sans")}>{value}</code>
        <Button size="sm" variant={copied ? "secondary" : "primary"} onClick={copy} aria-live="polite">{copied ? "Copied" : "Copy"}</Button>
      </div>
      {shareText && (
        <div className="flex gap-2 mt-3">
          {canShare && <Button size="sm" variant="secondary" onClick={() => navigator.share({ title: shareText, url: value }).catch(() => {})}>Share…</Button>}
          <a className="inline-flex items-center h-9 px-3.5 rounded-[10px] text-[14px] font-medium ring-1 ring-inset ring-line-strong bg-surface hover:bg-sunken"
            href={`mailto:?subject=${encodeURIComponent(shareText)}&body=${encodeURIComponent(`${shareText}: ${value}`)}`}>Email</a>
        </div>
      )}
    </div>
  );
}
