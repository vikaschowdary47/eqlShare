import Link from "next/link";
import { APP_NAME, APP_SLUG } from "@/lib/brand";
import type { ComponentProps, ReactNode } from "react";
import { formatUSD } from "@/lib/domain/money";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

/* ---------- brand ---------- */
/**
 * The eqlTab lockup (icon + wordmark) from brand/: the light lockup normally, the dark lockup
 * when the app is in dark mode (data-theme="dark" on <html>) or when tone="light" puts it on a dark surface.
 */
export function Logo({ className, tone = "ink", height = 28 }: { className?: string; tone?: "ink" | "light"; height?: number }) {
  const width = Math.round((height * 467) / 120);
  const img = (v: "light" | "dark", cls?: string) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/brand/${APP_SLUG}-lockup-${v}.svg`} alt={APP_NAME} width={width} height={height} className={cx("block", cls)} />
  );
  return (
    <span className={cx("inline-flex items-center", className)}>
      {tone === "light" ? img("dark") : <>{img("light", "logo-light")}{img("dark", "logo-dark")}</>}
    </span>
  );
}

/* ---------- buttons ---------- */
type Variant = "primary" | "secondary" | "ghost" | "danger" | "night";
const variants: Record<Variant, string> = {
  primary: "bg-ink text-white hover:bg-brand-ink shadow-[0_1px_0_rgba(255,255,255,0.1)_inset,0_1px_2px_rgba(11,26,24,0.2)]",
  secondary: "bg-surface text-ink ring-1 ring-inset ring-line-strong hover:ring-ink/40 hover:bg-sunken",
  ghost: "text-ink-2 hover:bg-sunken hover:text-ink",
  danger: "bg-surface text-error ring-1 ring-inset ring-error/30 hover:bg-error-wash",
  night: "bg-white text-ink hover:bg-brand-wash",
};
const sizes = { sm: "h-9 px-3.5 text-[14px] rounded-[10px]", md: "h-11 px-5 text-[15px] rounded-[12px]", lg: "h-[52px] px-6 text-[16px] rounded-[14px]" };

export function buttonClass(variant: Variant = "primary", size: keyof typeof sizes = "md", full = false) {
  return cx(
    "inline-flex items-center justify-center gap-2 font-medium tracking-[-0.01em] select-none whitespace-nowrap",
    "transition-[background-color,color,box-shadow,transform] duration-200 ease-out-soft active:scale-[0.98]",
    "disabled:opacity-45 disabled:pointer-events-none",
    variants[variant], sizes[size], full && "w-full",
  );
}

export function Button({ variant = "primary", size = "md", full, className, loading, children, ...rest }:
  ComponentProps<"button"> & { variant?: Variant; size?: keyof typeof sizes; full?: boolean; loading?: boolean }) {
  return (
    <button {...rest} disabled={rest.disabled || loading} aria-busy={loading || undefined} className={cx(buttonClass(variant, size, full), className)}>
      {loading && <Spinner />}
      {children}
    </button>
  );
}

export function ButtonLink({ variant = "primary", size = "md", full, className, ...rest }:
  ComponentProps<typeof Link> & { variant?: Variant; size?: keyof typeof sizes; full?: boolean }) {
  return <Link {...rest} className={cx(buttonClass(variant, size, full), className)} />;
}

export function Spinner() {
  return <span aria-hidden="true" className="size-4 rounded-full border-2 border-current border-r-transparent animate-spin" />;
}

/* ---------- forms ---------- */
export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink-2">{label}</label>
      {children}
      {error ? <p id={`${htmlFor}-error`} className="text-[13px] text-error flex gap-1.5 items-start"><span aria-hidden="true">!</span>{error}</p>
        : hint ? <p id={`${htmlFor}-hint`} className="text-[13px] text-muted">{hint}</p> : null}
    </div>
  );
}

export const inputClass =
  "block w-full h-12 rounded-[12px] bg-surface px-3.5 text-[16px] text-ink ring-1 ring-inset ring-line-strong placeholder:text-muted/70 " +
  "transition-shadow focus:outline-none focus:ring-2 focus:ring-brand-strong aria-[invalid=true]:ring-error";

export function Input(props: ComponentProps<"input">) {
  return <input {...props} className={cx(inputClass, props.className)} />;
}

export function Select(props: ComponentProps<"select">) {
  return (
    <div className="relative">
      <select {...props} className={cx(inputClass, "appearance-none pr-10", props.className)} />
      <svg className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-muted" width="12" height="8" viewBox="0 0 12 8" aria-hidden="true"><path d="M1 1.5l5 5 5-5" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" /></svg>
    </div>
  );
}

/* ---------- surfaces ---------- */
export function Card({ className, children, as: As = "section", ...rest }: { className?: string; children: ReactNode; as?: "section" | "div" | "article" } & Record<string, unknown>) {
  return <As {...rest} className={cx("rounded-[18px] bg-surface ring-1 ring-line shadow-[0_1px_2px_rgba(11,26,24,0.04)]", className)}>{children}</As>;
}

export function SectionTitle({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="flex items-end justify-between gap-3 mb-3">
      <h2 id={id} className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{children}</h2>
      {action}
    </div>
  );
}

/* ---------- money ---------- */
export function Money({ cents, size = "md", className }: { cents: number; size?: "sm" | "md" | "lg" | "xl"; className?: string }) {
  const s = { sm: "text-[22px]", md: "text-[30px]", lg: "text-[44px]", xl: "text-[clamp(52px,12vw,76px)]" }[size];
  const [d, c] = formatUSD(cents).split(".");
  return (
    <span className={cx("figure", s, className)} aria-label={formatUSD(cents)}>
      <span aria-hidden="true">{d}<span className="opacity-55">.{c}</span></span>
    </span>
  );
}

/** Signature component: proportional shares that visibly add up to the whole. */
export function ShareBar({ parts, tone = "light", className }: { parts: { key: string; cents: number; state: "paid" | "pending" | "open" | "own" }[]; tone?: "light" | "dark"; className?: string }) {
  const total = parts.reduce((a, p) => a + p.cents, 0) || 1;
  const color = (s: string) =>
    tone === "dark"
      ? { paid: "bg-brand", pending: "bg-brand/45 bg-[repeating-linear-gradient(135deg,transparent_0_3px,rgba(11,26,24,.35)_3px_5px)]", open: "bg-white/18", own: "bg-white/40" }[s]
      : { paid: "bg-brand", pending: "bg-brand/40 bg-[repeating-linear-gradient(135deg,transparent_0_3px,rgba(255,255,255,.6)_3px_5px)]", open: "bg-line-strong", own: "bg-ink-2/30" }[s];
  return (
    <div className={cx("flex h-2 w-full gap-[3px]", className)} aria-hidden="true">
      {parts.map((p, i) => (
        <span key={p.key} className={cx("grow-x h-full rounded-full", color(p.state))} style={{ flexGrow: p.cents / total, animationDelay: `${i * 60}ms` }} />
      ))}
    </div>
  );
}

/* ---------- status ---------- */
export type Tone = "neutral" | "brand" | "success" | "warning" | "error";
const toneClass: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-2",
  brand: "bg-brand-wash text-brand-ink",
  success: "bg-success-wash text-success",
  warning: "bg-warning-wash text-warning",
  error: "bg-error-wash text-error",
};
const toneIcon: Record<Tone, ReactNode> = {
  neutral: <circle cx="5" cy="5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />,
  brand: <circle cx="5" cy="5" r="3.5" fill="currentColor" />,
  success: <path d="M1.8 5.2l2.1 2.1L8.4 2.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
  warning: <path d="M5 1.5v4M5 7.8v.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />,
  error: <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />,
};

export function Chip({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 h-6 px-2 rounded-full text-[12px] font-medium whitespace-nowrap", toneClass[tone], className)}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">{toneIcon[tone]}</svg>
      {children}
    </span>
  );
}

/* ---------- feedback ---------- */
export function Notice({ tone = "neutral", title, children, action }: { tone?: Tone; title: string; children?: ReactNode; action?: ReactNode }) {
  const border = { neutral: "ring-line", brand: "ring-brand-strong/25", success: "ring-success/25", warning: "ring-warning/30", error: "ring-error/30" }[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cx("rounded-[14px] p-4 ring-1 flex gap-3 items-start", toneClass[tone].split(" ")[0], border)}>
      <span className={cx("mt-0.5 grid place-items-center size-5 rounded-full shrink-0", toneClass[tone])}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">{toneIcon[tone]}</svg>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-semibold text-ink">{title}</p>
        {children && <div className="text-[14px] text-ink-2 mt-0.5">{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ title, children, action, art }: { title: string; children?: ReactNode; action?: ReactNode; art?: ReactNode }) {
  return (
    <div className="text-center px-6 py-12 rounded-[18px] ring-1 ring-dashed ring-line-strong bg-surface/60">
      <div className="mx-auto mb-5 grid place-items-center">{art ?? <EqualsArt />}</div>
      <p className="text-[17px] font-semibold tracking-[-0.01em]">{title}</p>
      {children && <p className="text-[15px] text-muted mt-1.5 max-w-sm mx-auto">{children}</p>}
      {action && <div className="mt-5 flex justify-center gap-2 flex-wrap">{action}</div>}
    </div>
  );
}

export function EqualsArt() {
  return (
    <svg width="64" height="44" viewBox="0 0 64 44" aria-hidden="true">
      <rect x="2" y="8" width="60" height="9" rx="4.5" fill="var(--line)" />
      <rect x="2" y="8" width="38" height="9" rx="4.5" fill="var(--ink)" className="grow-x" />
      <rect x="2" y="27" width="60" height="9" rx="4.5" fill="var(--brand-wash)" />
      <rect x="2" y="27" width="60" height="9" rx="4.5" fill="var(--brand)" className="grow-x" style={{ animationDelay: "150ms" }} />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} aria-hidden="true" />;
}

export function Avatar({ name, size = 32, muted }: { name: string; size?: number; muted?: boolean }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
  const hues = ["#0f766e", "#1e3a8a", "#7c2d12", "#4338ca", "#155e75", "#3f6212", "#9f1239"];
  const h = hues[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % hues.length];
  return (
    <span aria-hidden="true" className="inline-grid place-items-center rounded-full font-semibold text-white shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.38, background: muted ? "var(--line-strong)" : h }}>
      {initials || "?"}
    </span>
  );
}
