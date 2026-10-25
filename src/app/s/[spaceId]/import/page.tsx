import { redirect } from "next/navigation";

/** The import flow is full-screen; keep a Space-scoped URL for the entry point. */
export default async function SpaceImport({ params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = await params;
  redirect(`/import?from=${spaceId}`);
}
