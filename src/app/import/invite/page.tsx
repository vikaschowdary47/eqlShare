import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getImportPeople, requireUser } from "@/lib/data";
import { InvitePeople } from "@/components/import/invite-people";

export const metadata: Metadata = { title: "Invite your people" };

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  const { batch } = await searchParams;
  await requireUser(`/import/invite?batch=${batch ?? ""}`);
  if (!batch || !/^[0-9a-f-]{36}$/.test(batch)) notFound();
  const people = await getImportPeople(batch);
  const firstSpace = people.flatMap((p) => p.spaces)[0]?.id;
  return <InvitePeople people={people} doneHref={firstSpace ? `/s/${firstSpace}/space?import=${batch}#members` : "/home"} />;
}
