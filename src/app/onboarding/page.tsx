import type { Metadata } from "next";
import { getMySpaces, getProfile, requireUser } from "@/lib/data";
import { Onboarding } from "@/components/onboarding/onboarding";

export const metadata: Metadata = { title: "Get started" };

export default async function OnboardingPage() {
  await requireUser("/onboarding");
  const [profile, spaces] = await Promise.all([getProfile(), getMySpaces()]);
  return <Onboarding firstName={profile?.display_name.split(" ")[0] ?? ""} hasSpaces={spaces.length > 0} />;
}
