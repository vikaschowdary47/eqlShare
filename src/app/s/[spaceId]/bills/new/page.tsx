import type { Metadata } from "next";
import { getSpaceContext } from "@/lib/data";
import { SPACE_PRESETS } from "@/lib/domain/spaces";
import { todayISO } from "@/lib/domain/due";
import { NewBillForm } from "@/components/new-bill-form";
import { ButtonLink, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Add expense" };

export default async function NewBillPage({ params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;
  const ctx = (await getSpaceContext(spaceId))!;
  if (!ctx.me) return <EmptyState title="You can't add bills here" action={<ButtonLink href={`/s/${spaceId}`} variant="secondary">Back</ButtonLink>}>You're no longer an active member of this Space.</EmptyState>;
  const preset = SPACE_PRESETS[ctx.space.type];
  return (
    <NewBillForm
      spaceId={spaceId}
      noun={preset.expenseNoun}
      defaultCategory={ctx.space.type === "group" ? "dining" : "electricity"}
      defaultMethod={ctx.space.default_split}
      meId={ctx.me.id}
      isOwner={ctx.me.role === "owner"}
      today={todayISO()}
      members={ctx.active.map((m) => ({ id: m.id, name: m.placeholder ? `${m.name} (not joined)` : m.name, isMe: m.id === ctx.me!.id }))}
    />
  );
}
