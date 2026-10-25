"use client";

import { useEffect, useRef, useState } from "react";
import { Button, cx } from "@/components/ui";

export interface PickedFile { id: string; file: File; url: string | null }

const isImage = (f: File) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name);
const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
let seq = 0;

/**
 * The one upload surface in the app: choose (photo library / files), take a photo,
 * paste (Cmd/Ctrl+V anywhere on the page) and drag-and-drop, with previews to remove before upload.
 * `kinds` controls what's allowed; the server still validates every file.
 */
export function FilePicker({ files, onChange, kinds, max = 1, maxBytes = 10 * 1024 * 1024, camera = false, label, hint, onError }: {
  files: PickedFile[];
  onChange: (files: PickedFile[]) => void;
  kinds: ("image" | "pdf")[];
  max?: number;
  maxBytes?: number;
  camera?: boolean;
  label: string;
  hint?: string;
  onError: (message: string | null) => void;
}) {
  const choose = useRef<HTMLInputElement>(null);
  const shoot = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [touch, setTouch] = useState(false);
  const latest = useRef({ files, onChange, onError });
  latest.current = { files, onChange, onError };

  const accept = [kinds.includes("image") && "image/*", kinds.includes("pdf") && "application/pdf,.pdf"].filter(Boolean).join(",");
  const noun = kinds.includes("image") ? (kinds.includes("pdf") ? "file" : "image") : "PDF";

  function add(list: Iterable<File>) {
    const { files, onChange, onError } = latest.current;
    onError(null);
    const picked = [...list];
    if (!picked.length) return;
    const bad = picked.find((f) => !((kinds.includes("image") && isImage(f)) || (kinds.includes("pdf") && isPdf(f))));
    if (bad) return onError(`${bad.name || "That file"} isn't ${noun === "image" ? "an image" : noun === "PDF" ? "a PDF" : "an image or PDF"}.`);
    const big = picked.find((f) => f.size > maxBytes);
    if (big) return onError(`${big.name || "That file"} is over ${Math.round(maxBytes / 1024 / 1024)} MB.`);
    const fresh = picked.map((file) => ({ id: `f${++seq}`, file, url: isImage(file) ? URL.createObjectURL(file) : null }));
    // A single-file picker replaces its file; a multi-file one appends up to the limit
    const next = max === 1 ? fresh.slice(0, 1) : [...files, ...fresh];
    if (next.length > max) return onError(`You can add up to ${max} ${noun}s.`);
    if (max === 1) files.forEach((f) => f.url && URL.revokeObjectURL(f.url));
    onChange(next);
  }

  function remove(id: string) {
    const { files, onChange } = latest.current;
    const gone = files.find((f) => f.id === id);
    if (gone?.url) URL.revokeObjectURL(gone.url);
    onChange(files.filter((f) => f.id !== id));
  }

  useEffect(() => {
    setTouch(window.matchMedia("(pointer: coarse)").matches);
    function onPaste(e: ClipboardEvent) {
      const pasted = [...(e.clipboardData?.files ?? [])];
      if (!pasted.length) return; // plain text paste into fields behaves normally
      e.preventDefault();
      // Clipboard images are often unnamed "image.png"; give them a readable name
      add(pasted.map((f, i) => (f.name && f.name !== "image.png" ? f : new File([f], `Pasted image ${i + 1}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: f.type }))));
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const full = files.length >= max;

  return (
    <div
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false); }}
      onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
      className={cx("rounded-[18px] border-2 border-dashed p-4 sm:p-6 transition-all duration-300",
        drag ? "border-teal bg-teal-wash scale-[1.01]" : "border-line-strong bg-surface")}>
      {files.length > 0 && (
        <ul className={cx("mb-5 grid gap-3", kinds.includes("image") ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-1")} aria-label="Added files">
          {files.map((f, i) => (
            <li key={f.id} className={cx("relative overflow-hidden rounded-[14px] ring-1 ring-line bg-sunken", f.url ? "aspect-[9/16]" : "flex items-center gap-3 p-3 pr-12")}>
              {f.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.url} alt={`${label} ${i + 1}`} className="size-full object-cover object-top" />
              ) : (
                <>
                  <span className="grid place-items-center size-10 shrink-0 rounded-[10px] bg-surface ring-1 ring-line text-[11px] font-semibold text-ink-2">PDF</span>
                  <span className="min-w-0">
                    <span className="block truncate text-[15px] font-medium">{f.file.name}</span>
                    <span className="block text-[13px] text-muted num">{(f.file.size / 1024 / 1024).toFixed(1)} MB</span>
                  </span>
                </>
              )}
              <button type="button" aria-label={`Remove ${f.file.name || `${label} ${i + 1}`}`} onClick={() => remove(f.id)}
                className="absolute top-1.5 right-1.5 grid place-items-center size-8 rounded-full bg-ink/80 text-white text-[16px] hover:bg-ink">×</button>
            </li>
          ))}
        </ul>
      )}

      {!full && (
        <div className="text-center">
          {files.length === 0 && (
            <svg className="mx-auto text-ink-2" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
            </svg>
          )}
          <div className="mt-3 flex flex-col sm:flex-row gap-2 justify-center">
            <Button type="button" variant={files.length ? "secondary" : "primary"} onClick={() => choose.current?.click()}>
              {files.length ? `Add more` : kinds.includes("image") ? (touch ? "Choose from Photos or Files" : `Choose ${noun}s`) : "Choose a PDF"}
            </Button>
            {camera && kinds.includes("image") && touch && (
              <Button type="button" variant="secondary" onClick={() => shoot.current?.click()}>Take photo</Button>
            )}
          </div>
          <p className="mt-3 text-[13px] text-muted">
            {touch ? `You can also paste ${noun === "PDF" ? "a PDF" : "an image"} you copied.` : `Or drag ${noun}s here, or paste with ${typeof navigator !== "undefined" && /Mac|iP/.test(navigator.platform) ? "⌘" : "Ctrl"}+V.`}
            {hint && <> {hint}</>}
          </p>
        </div>
      )}

      <input ref={choose} type="file" accept={accept} multiple={max > 1} hidden aria-hidden="true" data-picker="choose"
        onChange={(e) => { add(e.target.files ?? []); e.target.value = ""; }} />
      {camera && (
        <input ref={shoot} type="file" accept="image/*" capture="environment" hidden aria-hidden="true" data-picker="camera"
          onChange={(e) => { add(e.target.files ?? []); e.target.value = ""; }} />
      )}
    </div>
  );
}
