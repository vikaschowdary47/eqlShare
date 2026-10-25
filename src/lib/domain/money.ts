/** All money is integer cents (USD). Never use floats for arithmetic. */
export type Cents = number;

export function assertCents(value: number, label = "amount"): asserts value is Cents {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be an integer number of cents`);
}

/** Parse user input like "137.01", "$1,200", "0.5" into cents. Returns null when invalid. */
export function parseDollars(input: string): Cents | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

export function formatUSD(cents: Cents): string {
  return usd.format(cents / 100);
}

/** "137.01" style string for form inputs. */
export function centsToInput(cents: Cents): string {
  return (cents / 100).toFixed(2);
}
