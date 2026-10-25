import type { Metadata } from "next";
import { getOwnedSpacesWithMembers, getMySpaces, requireUser } from "@/lib/data";
import { ImportFlow } from "@/components/import/import-flow";

export const metadata: Metadata = { title: "Import from Splitwise" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const { from } = await searchParams;
  await requireUser("/import");
  const [spaces, mine] = await Promise.all([getOwnedSpacesWithMembers(), getMySpaces()]);
  return <ImportFlow spaces={spaces} backHref={from && /^[0-9a-f-]{36}$/.test(from) ? `/s/${from}/space` : mine.length ? "/home" : "/onboarding"} />;
}
