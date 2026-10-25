"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cx } from "@/components/ui";

const ICONS = {
  home: <path d="M4 10.5 12 4l8 6.5V20h-5v-6h-6v6H4z" />,
  bills: <><rect x="5" y="3.5" width="14" height="17" rx="2.5" /><path d="M9 8.5h6M9 12h6M9 15.5h3.5" /></>,
  activity: <path d="M3.5 12h4l2.5-6 4 12 2.5-6h4" />,
  space: <><circle cx="9" cy="9" r="3" /><circle cx="17" cy="10" r="2.3" /><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5M15 14.2c2.6-.4 4.6 1.2 5.3 4.3" /></>,
};

export function navItems(spaceId: string) {
  return [
    { href: `/s/${spaceId}`, label: "Home", icon: ICONS.home, exact: true },
    { href: `/s/${spaceId}/bills`, label: "Bills", icon: ICONS.bills },
    { href: `/s/${spaceId}/activity`, label: "Activity", icon: ICONS.activity },
    { href: `/s/${spaceId}/space`, label: "Space", icon: ICONS.space },
  ];
}

function isActive(path: string, href: string, exact?: boolean) {
  return exact ? path === href : path === href || path.startsWith(href + "/") || (href.endsWith("/bills") && path.includes("/auto-bills"));
}

export function SideNav({ spaceId }: { spaceId: string }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="grid gap-0.5">
      {navItems(spaceId).map((i) => {
        const on = isActive(path, i.href, i.exact);
        return (
          <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}
            className={cx("group flex items-center gap-3 h-10 px-3 rounded-[10px] text-[15px] transition-colors",
              on ? "bg-surface text-ink font-medium ring-1 ring-line shadow-[0_1px_2px_rgba(11,26,24,0.05)]" : "text-ink-2 hover:text-ink hover:bg-surface/60")}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? 1.9 : 1.6} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">{i.icon}</svg>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function TabBar({ spaceId }: { spaceId: string }) {
  const path = usePathname();
  const items = navItems(spaceId);
  const render = (i: (typeof items)[number]) => {
    const on = isActive(path, i.href, i.exact);
    return (
      <Link key={i.href} href={i.href} aria-current={on ? "page" : undefined}
        className={cx("flex-1 flex flex-col items-center justify-center gap-1 h-full text-[11px] transition-colors", on ? "text-ink font-semibold" : "text-muted")}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? 2 : 1.6} strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">{i.icon}</svg>
        {i.label}
      </Link>
    );
  };
  return (
    <nav aria-label="Main" className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/90 backdrop-blur-xl border-t border-line pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-stretch h-[62px] max-w-lg mx-auto px-2">
        {items.slice(0, 2).map(render)}
        <div className="flex-1 grid place-items-center"><AddMenu spaceId={spaceId} compact /></div>
        {items.slice(2).map(render)}
      </div>
    </nav>
  );
}

export function AddMenu({ spaceId, compact }: { spaceId: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  const items = [
    { href: `/s/${spaceId}/bills/new`, t: "Expense or bill", d: "Enter an amount and split it" },
    { href: `/s/${spaceId}/auto-bills`, t: "Upload a statement", d: "We read it, you confirm it" },
  ];
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}
        className={cx("inline-flex items-center justify-center gap-2 font-medium text-white bg-ink hover:bg-teal-ink transition-all duration-300 ease-out-soft active:scale-95",
          compact ? "size-12 rounded-[16px] shadow-[0_8px_20px_-8px_rgba(11,26,24,0.6)]" : "h-11 w-full rounded-[12px] text-[15px]")}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" className={cx("transition-transform duration-300", open && "rotate-45")}><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
        {compact ? <span className="sr-only">Add</span> : "Add"}
      </button>
      {open && (
        <div role="menu" className={cx("absolute z-40 w-[280px] rounded-[16px] bg-surface ring-1 ring-line shadow-[0_24px_60px_-20px_rgba(11,26,24,0.35)] p-1.5 rise",
          compact ? "bottom-[64px] left-1/2 -translate-x-1/2" : "top-[52px] left-0")}>
          {items.map((i) => (
            <Link key={i.href} role="menuitem" href={i.href} onClick={() => setOpen(false)} className="block rounded-[12px] px-3.5 py-3 hover:bg-sunken focus:bg-sunken">
              <span className="block text-[15px] font-medium">{i.t}</span>
              <span className="block text-[13px] text-muted">{i.d}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function SpaceSwitcher({ current, spaces }: { current: { id: string; name: string; typeLabel: string }; spaces: { id: string; name: string; typeLabel: string }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);
  return (
    <div ref={ref} className="relative min-w-0">
      <button type="button" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2.5 w-full min-w-0 rounded-[12px] px-2 py-1.5 -mx-2 hover:bg-surface/70 text-left transition-colors">
        <span className="grid place-items-center size-8 rounded-[10px] bg-ink text-white text-[13px] font-semibold shrink-0" aria-hidden="true">{current.name.slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold truncate leading-tight">{current.name}</span>
          <span className="block text-[12px] text-muted leading-tight">{current.typeLabel}</span>
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" className="text-muted shrink-0"><path d="M8 9l4-4 4 4M8 15l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span className="sr-only">Switch Space</span>
      </button>
      {open && (
        <div role="menu" className="absolute z-40 top-[52px] left-0 w-[min(300px,calc(100vw-32px))] rounded-[16px] bg-surface ring-1 ring-line shadow-[0_24px_60px_-20px_rgba(11,26,24,0.35)] p-1.5 rise">
          <p className="px-3 pt-2 pb-1 text-[12px] text-muted">Your Spaces</p>
          {spaces.map((s) => (
            <Link key={s.id} role="menuitem" href={`/s/${s.id}`} onClick={() => setOpen(false)} aria-current={s.id === current.id ? "true" : undefined}
              className="flex items-center gap-3 rounded-[12px] px-3 py-2.5 hover:bg-sunken">
              <span className="grid place-items-center size-7 rounded-[8px] bg-sunken ring-1 ring-line text-[12px] font-semibold" aria-hidden="true">{s.name.slice(0, 1).toUpperCase()}</span>
              <span className="flex-1 min-w-0"><span className="block text-[14px] font-medium truncate">{s.name}</span><span className="block text-[12px] text-muted">{s.typeLabel}</span></span>
              {s.id === current.id && <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" stroke="var(--teal)" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>}
            </Link>
          ))}
          <div className="h-px bg-line my-1.5" />
          <Link role="menuitem" href="/onboarding" className="flex items-center gap-3 rounded-[12px] px-3 py-2.5 hover:bg-sunken text-[14px] font-medium">
            <span className="grid place-items-center size-7 rounded-[8px] ring-1 ring-dashed ring-line-strong" aria-hidden="true">+</span>New Space or join one
          </Link>
        </div>
      )}
    </div>
  );
}
