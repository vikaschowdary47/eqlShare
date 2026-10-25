"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { uploadStatementAction } from "@/lib/actions";
import { FilePicker, type PickedFile } from "./upload/file-picker";
import { Button, Notice, Spinner } from "./ui";

export function UploadStatement({ spaceId }: { spaceId: string }) {
  const router = useRouter();
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function send() {
    const file = files[0]?.file;
    if (!file) return;
    setError(null);
    const form = new FormData();
    form.set("file", file);
    start(async () => {
      const r = await uploadStatementAction(spaceId, form);
      if (!r.ok) return setError(r.error);
      router.push(`/s/${spaceId}/auto-bills/${r.data.id}`);
    });
  }

  return (
    <div>
      {pending ? (
        <div className="flex flex-col items-center gap-3 rounded-[18px] border-2 border-dashed border-line-strong bg-surface p-8 text-center" role="status">
          <Spinner />
          <p className="text-[15px] font-medium">Reading {files[0]?.file.name}…</p>
          <p className="text-[13px] text-muted">Finding the provider, amount, due date and billing period</p>
        </div>
      ) : (
        <>
          <FilePicker files={files} onChange={setFiles} onError={setError} kinds={["pdf", "image"]} camera label="Bill" hint="PDF, photo or screenshot, up to 10 MB." />
          {files.length > 0 && <Button className="mt-3" full onClick={send}>Read statement</Button>}
        </>
      )}
      {error && <div className="mt-3"><Notice tone="error" title={error} /></div>}
      <p className="mt-3 text-[13px] text-muted">Nothing is shared until you check the details and confirm. PDFs are stored privately and only members of this Space can open them. Photos are read once and not stored.</p>
    </div>
  );
}
