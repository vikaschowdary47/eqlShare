import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getMySpaces, requireUser } from "@/lib/data";

export default async function HomeRedirect() {
  await requireUser("/home");
  const spaces = await getMySpaces();
  if (spaces.length === 0) redirect("/onboarding");
  const last = (await cookies()).get("eql_space")?.value;
  const target = spaces.find((s) => s.id === last) ?? spaces[0];
  redirect(`/s/${target.id}`);
}
