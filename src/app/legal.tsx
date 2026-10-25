import Link from "next/link";
import { Logo, Notice } from "@/components/ui";
import { APP_NAME } from "@/lib/brand";

export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[720px] px-5 py-10">
      <Link href="/" aria-label={`${APP_NAME} home`}><Logo /></Link>
      <main className="mt-12 space-y-5 text-[16px] text-ink-2 leading-relaxed [&_h2]:text-ink [&_h2]:font-semibold [&_h2]:text-[19px] [&_h2]:mt-8">
        <h1 className="text-[36px] font-semibold tracking-[-0.04em] text-ink">{title}</h1>
        <Notice tone="warning" title="Draft for the closed beta">This page describes how the beta works today. It must be reviewed by a lawyer before public launch.</Notice>
        {children}
      </main>
    </div>
  );
}
