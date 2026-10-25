import type { SplitMethod } from "./split";

export const SPACE_TYPES = ["shared_home", "couple", "family", "group"] as const;
export type SpaceType = (typeof SPACE_TYPES)[number];

/** Presets only: labels and suggested defaults. Never financial rules. */
export const SPACE_PRESETS: Record<
  SpaceType,
  { label: string; blurb: string; nameExamples: string[]; defaultSplit: SplitMethod; autoBillsFirst: boolean; expenseNoun: string }
> = {
  shared_home: { label: "Shared Home", blurb: "Roommates, students, shared apartments", nameExamples: ["Maple Apartment", "Our Home"], defaultSplit: "equal", autoBillsFirst: true, expenseNoun: "bill" },
  couple: { label: "Couple", blurb: "Manage expenses with your partner", nameExamples: ["Our Home", "Sam & Riley"], defaultSplit: "equal", autoBillsFirst: false, expenseNoun: "expense" },
  family: { label: "Family", blurb: "Household bills and family expenses", nameExamples: ["Family Expenses", "The Okafors"], defaultSplit: "exact", autoBillsFirst: true, expenseNoun: "bill" },
  group: { label: "Group", blurb: "Friends, trips, events, and shared costs", nameExamples: ["Weekend Trip", "Tahoe 2026"], defaultSplit: "equal", autoBillsFirst: false, expenseNoun: "expense" },
};

export function isSpaceType(v: unknown): v is SpaceType {
  return typeof v === "string" && (SPACE_TYPES as readonly string[]).includes(v);
}
