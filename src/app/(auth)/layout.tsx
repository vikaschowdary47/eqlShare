import Link from "next/link";
import { Logo } from "@/components/ui";
import { ExampleObligationCard } from "@/components/example-card";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-5 sm:px-10 py-6">
        <Link href="/" aria-label="Eqlshare home" className="self-start"><Logo /></Link>
        <main className="flex-1 grid place-items-center py-10">
          <div className="w-full max-w-[400px] rise">{children}</div>
        </main>
        <p className="text-[13px] text-muted">No bank account needed. Eqlshare never moves your money.</p>
      </div>
      <aside className="hidden lg:flex relative overflow-hidden bg-night grain m-3 rounded-[28px] flex-col justify-between p-12 text-white">
        <p className="text-[13px] tracking-[0.14em] uppercase text-white/55">Shared bills, organized</p>
        <div className="max-w-[440px] w-full mx-auto">
          <ExampleObligationCard />
        </div>
        <blockquote className="max-w-[460px]">
          <p className="figure text-[34px] leading-[1.1] text-white">Everyone sees the same bill, the same due date, and exactly what their share is.</p>
        </blockquote>
      </aside>
    </div>
  );
}
