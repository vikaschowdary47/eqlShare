"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { uploadStatementAction } from "@/lib/actions";
import { Notice, Spinner, cx } from "./ui";

export function UploadStatement({ spaceId }: { spaceId: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [stage, setStage] = useState("");

  function send(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (file.type && file.type !== "application/pdf") return setError("Choose a PDF file.");
    if (file.size > 10 * 1024 * 1024) return setError("That file is over 10 MB.");
    const form = new FormData();
    form.set("file", file);
    setStage(`Reading ${file.name}…`);
    start(async () => {
      const r = await uploadStatementAction(spaceId, form);
      if (!r.ok) { setStage(""); return setError(r.error); }
      router.push(`/s/${spaceId}/auto-bills/${r.data.id}`);
    });
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); send(e.dataTransfer.files[0]); }}
        className={cx("relative rounded-[18px] border-2 border-dashed p-8 text-center transition-all duration-300",
          drag ? "border-teal bg-teal-wash scale-[1.01]" : "border-line-strong bg-surface")}>
        {pending ? (
          <div className="flex flex-col items-center gap-3 py-2" role="status">
            <Spinner />
            <p className="text-[15px] font-medium">{stage}</p>
            <p className="text-[13px] text-muted">Finding the provider, amount, due date and billing period</p>
          </div>
        ) : (
          <>
            <svg className="mx-auto text-ink-2" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M12 18v-6M9 15l3-3 3 3" />
            </svg>
            <p className="mt-3 text-[16px] font-medium">Drop a PDF statement here</p>
            <p className="text-[14px] text-muted mt-1">or <button type="button" onClick={() => input.current?.click()} className="text-teal-ink underline underline-offset-4 decoration-teal/30 hover:decoration-teal font-medium">choose a file</button> · PDF up to 10 MB</p>
            <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" aria-label="Upload a PDF statement" onChange={(e) => send(e.target.files?.[0])} />
          </>
        )}
      </div>
      {error && <div className="mt-3"><Notice tone="error" title={error} /></div>}
      <p className="mt-3 text-[13px] text-muted">Nothing is shared until you check the details and confirm. The original file is stored privately and only members of this Space can open it.</p>
    </div>
  );
}
