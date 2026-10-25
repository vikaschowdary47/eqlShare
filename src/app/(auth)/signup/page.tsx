import Link from "next/link";
import type { Metadata } from "next";
import { SignUpForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next = "/onboarding" } = await searchParams;
  return (
    <>
      <h1 className="text-[32px] font-semibold tracking-[-0.035em] leading-tight">Create your account</h1>
      <p className="text-muted mt-2 mb-8">Free for shared expenses. No bank details, ever.</p>
      <SignUpForm next={next} />
      <p className="mt-8 text-[15px] text-ink-2">Already have an account? <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-medium text-teal-ink underline underline-offset-4 decoration-teal/30 hover:decoration-teal">Sign in</Link></p>
    </>
  );
}
