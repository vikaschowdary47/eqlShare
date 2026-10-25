import type { Metadata } from "next";
import { getActivity, getSpaceContext } from "@/lib/data";
import { ActivityList } from "@/components/activity";
import { Card, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage({ params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;
  const ctx = (await getSpaceContext(spaceId))!;
  const items = await getActivity(spaceId, 100);
  return (
    <div className="max-w-[760px] space-y-8">
      <header className="rise">
        <h1 className="text-[clamp(28px,5vw,40px)] font-semibold tracking-[-0.04em] leading-tight">Activity</h1>
        <p className="text-muted mt-1">Everything that happened in {ctx.space.name}, newest first. Nothing here can be edited or deleted.</p>
      </header>
      {items.length ? <Card className="overflow-hidden"><ActivityList items={items} members={ctx.members} meUserId={ctx.userId} spaceId={spaceId} /></Card>
        : <EmptyState title="No activity yet">Bills, payments and member changes show up here.</EmptyState>}
    </div>
  );
}
