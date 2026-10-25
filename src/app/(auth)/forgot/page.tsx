import Link from "next/link";
import type { Metadata } from "next";
import { ForgotForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPage() {
  return (
    <>
      <h1 className="text-[32px] font-semibold tracking-[-0.035em] leading-tight">Reset your password</h1>
      <p className="text-muted mt-2 mb-8">We'll email you a link to choose a new one.</p>
      <ForgotForm />
      <p className="mt-8 text-[15px]"><Link href="/login" className="text-teal-ink underline underline-offset-4 decoration-teal/30">Back to sign in</Link></p>
    </>
  );
}
