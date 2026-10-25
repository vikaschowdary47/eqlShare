import type { Metadata } from "next";
import { ResetForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPage() {
  return (
    <>
      <h1 className="text-[32px] font-semibold tracking-[-0.035em] leading-tight">Choose a new password</h1>
      <p className="text-muted mt-2 mb-8">You'll stay signed in on this device.</p>
      <ResetForm />
    </>
  );
}
