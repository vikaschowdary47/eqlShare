/**
 * Rule-based extraction from statement text (PDF text layer or email body).
 * It never guesses: a field is either found unambiguously, ambiguous, or missing,
 * and anything short of "found" sends the statement to human review.
 */
import { parseDollars, type Cents } from "./money";

export type FieldStatus = "found" | "ambiguous" | "missing";

export interface Extraction {
  kind: "statement" | "notice_only";
  provider: { value: string | null; status: FieldStatus };
  amountDueCents: { value: Cents | null; status: FieldStatus };
  dueDate: { value: string | null; status: FieldStatus };
  periodStart: string | null;
  periodEnd: string | null;
  accountLast4: string | null;
  statementId: string | null;
  needsReview: boolean;
  reasons: string[];
  parserVersion: string;
}

export const PARSER_VERSION = "rules-1";
/** Above this, a human must look even when every field parsed cleanly. */
export const LARGE_AMOUNT_CENTS = 100_000;

const PROVIDERS: { name: string; re: RegExp }[] = [
  { name: "ComEd", re: /\bcomed\b|commonwealth edison/i },
  { name: "Southern Connecticut Gas", re: /southern connecticut gas|\bscg\b/i },
  { name: "Con Edison", re: /con\s?edison|coned\b/i },
  { name: "PG&E", re: /pg&e|pacific gas and electric/i },
  { name: "Xfinity", re: /xfinity|comcast/i },
  { name: "Spectrum", re: /\bspectrum\b/i },
  { name: "Verizon", re: /\bverizon\b/i },
  { name: "AT&T", re: /\bat&t\b/i },
  { name: "Peoples Gas", re: /peoples gas/i },
  { name: "Eversource", re: /eversource/i },
];

const MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
const MONTH_NUM: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const DATE =`(\\d{1,2}/\\d{1,2}/\\d{2,4}|(?:${MONTHS})[a-z]*\\.?\\s+\\d{1,2},?\\s+\\d{4})`;
const MONEY = `\\$\\s?([\\d,]+\\.\\d{2})`;

const AMOUNT_LABELS = /(total amount due|amount due|total due|please pay|balance due|new charges due)/i;
const DUE_LABELS = /(payment due date|due date|due by|please pay by|pay by)/i;

export function toISODate(s: string): string | null {
  const t = s.trim().replace(/\.(?=\s)/, "");
  let m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return iso(y, Number(m[1]), Number(m[2]));
  }
  m = t.match(new RegExp(`^(${MONTHS})[a-z]*\\s+(\\d{1,2}),?\\s+(\\d{4})$`, "i"));
  if (m) {
    const month = MONTH_NUM[m[1].toLowerCase()];
    return iso(Number(m[3]), month, Number(m[2]));
  }
  return null;
}

function iso(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** Values that appear on the same line as a label, or on the line right after it. */
function labeled(lines: string[], label: RegExp, value: RegExp): string[] {
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (!label.test(line)) return;
    const after = line.slice(line.search(label));
    const hit = after.match(value) ?? lines[i + 1]?.match(value);
    if (hit) out.push(hit[1]);
  });
  return out;
}

export function extractStatement(text: string): Extraction {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const reasons: string[] = [];

  const providers = uniq(PROVIDERS.filter((p) => p.re.test(text)).map((p) => p.name));
  const provider =
    providers.length === 1 ? { value: providers[0], status: "found" as const }
    : providers.length > 1 ? { value: null, status: "ambiguous" as const }
    : { value: null, status: "missing" as const };

  const amounts = uniq(labeled(lines, AMOUNT_LABELS, new RegExp(MONEY)).map((a) => parseDollars(a)).filter((a): a is number => a !== null));
  const amountDueCents =
    amounts.length === 1 ? { value: amounts[0], status: "found" as const }
    : amounts.length > 1 ? { value: null, status: "ambiguous" as const }
    : { value: null, status: "missing" as const };

  const dues = uniq(labeled(lines, DUE_LABELS, new RegExp(DATE, "i")).map(toISODate).filter((d): d is string => d !== null));
  const dueDate =
    dues.length === 1 ? { value: dues[0], status: "found" as const }
    : dues.length > 1 ? { value: null, status: "ambiguous" as const }
    : { value: null, status: "missing" as const };

  const period = text.match(new RegExp(`(?:billing|service) period[^\\d\\w]*(?:from\\s+)?${DATE}\\s*(?:-|to|through|–)\\s*${DATE}`, "i"));
  const periodStart = period ? toISODate(period[1]) : null;
  const periodEnd = period ? toISODate(period[2]) : null;

  const acct = text.match(/account (?:number|no\.?|#)[:\s#]*([\d\- ]{6,})/i);
  const accountLast4 = acct ? acct[1].replace(/\D/g, "").slice(-4) || null : null;
  const sid = text.match(/(?:statement|invoice|bill) (?:number|no\.?|#|id)[:\s#]*([A-Z0-9-]{4,})/i);
  const statementId = sid ? sid[1] : null;

  const looksLikeNotice =
    amountDueCents.status === "missing" && dueDate.status === "missing" &&
    /(statement is ready|bill is ready|view your bill|sign in to view|log in to view|is now available)/i.test(text);

  if (provider.status !== "found") reasons.push(provider.status === "ambiguous" ? "More than one provider name appears" : "Provider not recognized");
  if (amountDueCents.status !== "found") reasons.push(amountDueCents.status === "ambiguous" ? "Found more than one amount due" : "Amount due not found");
  if (dueDate.status !== "found") reasons.push(dueDate.status === "ambiguous" ? "Found more than one due date" : "Due date not found");
  if (amountDueCents.value !== null && amountDueCents.value >= LARGE_AMOUNT_CENTS) reasons.push("Amount is unusually large");
  if (amountDueCents.value === 0) reasons.push("Amount due is $0.00");

  return {
    kind: looksLikeNotice ? "notice_only" : "statement",
    provider, amountDueCents, dueDate, periodStart, periodEnd, accountLast4, statementId,
    needsReview: reasons.length > 0,
    reasons,
    parserVersion: PARSER_VERSION,
  };
}

/** Identity used for duplicate and revision detection. */
export function statementKey(e: Pick<Extraction, "provider" | "accountLast4" | "periodStart" | "periodEnd" | "statementId">): string | null {
  if (!e.provider.value) return null;
  if (e.periodStart && e.periodEnd) return [e.provider.value, e.accountLast4 ?? "", e.periodStart, e.periodEnd].join("|");
  if (e.statementId) return [e.provider.value, e.accountLast4 ?? "", "id", e.statementId].join("|");
  return null;
}

export const VISION_PARSER_VERSION = "vision-1";
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Builds an Extraction from what a vision model read off a photo or screenshot of a bill.
 * Same contract as the text parser: a field the model wasn't sure of is "ambiguous",
 * so it goes to human review rather than being trusted.
 */
export function statementFromVision(raw: unknown): Extraction {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const conf = (k: string) => (typeof o[`${k}_confidence`] === "number" ? (o[`${k}_confidence`] as number) : 0);
  const str = (k: string, max = 80) => (typeof o[k] === "string" && (o[k] as string).trim() ? (o[k] as string).trim().slice(0, max) : null);
  const date = (k: string) => { const v = str(k, 10); return v && ISO.test(v) && toISODate(v.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$2/$3/$1")) === v ? v : null; };
  const field = <T,>(value: T | null, c: number) =>
    value === null ? { value: null, status: "missing" as const } : c >= 0.7 ? { value, status: "found" as const } : { value: null, status: "ambiguous" as const };

  const cents = typeof o.amount_due_cents === "number" && Number.isSafeInteger(o.amount_due_cents) && o.amount_due_cents >= 0 ? o.amount_due_cents : null;
  const provider = field(str("provider"), conf("provider"));
  const amountDueCents = field(cents, conf("amount_due"));
  const dueDate = field(date("due_date"), conf("due_date"));
  const reasons: string[] = ["Read from a photo. Check every field against the original."];
  if (provider.status !== "found") reasons.push(provider.status === "ambiguous" ? "Provider name was hard to read" : "Provider not found");
  if (amountDueCents.status !== "found") reasons.push(amountDueCents.status === "ambiguous" ? "Amount due was hard to read" : "Amount due not found");
  if (dueDate.status !== "found") reasons.push(dueDate.status === "ambiguous" ? "Due date was hard to read" : "Due date not found");
  if (cents !== null && cents >= LARGE_AMOUNT_CENTS) reasons.push("Amount is unusually large");
  if (cents === 0) reasons.push("Amount due is $0.00");
  const last4 = str("account_last4", 4);

  return {
    kind: o.is_bill === false ? "notice_only" : "statement",
    provider, amountDueCents, dueDate,
    periodStart: date("period_start"), periodEnd: date("period_end"),
    accountLast4: last4 && /^\d{4}$/.test(last4) ? last4 : null,
    statementId: str("statement_number", 40),
    needsReview: true, // photos are always checked by a person
    reasons,
    parserVersion: VISION_PARSER_VERSION,
  };
}
