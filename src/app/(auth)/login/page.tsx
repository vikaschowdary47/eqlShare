import Link from "next/link";
import type { Metadata } from "next";
import { SignInForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next = "/home" } = await searchParams;
  return (
    <>
      <h1 className="text-[32px] font-semibold tracking-[-0.035em] leading-tight">Welcome back</h1>
      <p className="text-muted mt-2 mb-8">Sign in to see what's due in your Spaces.</p>
      <SignInForm next={next} />
      <p className="mt-8 text-[15px] text-ink-2">New to Eqlshare? <Link href={`/signup?next=${encodeURIComponent(next)}`} className="font-medium text-brand-ink underline underline-offset-4 decoration-brand-strong/30 hover:decoration-brand-strong">Create an account</Link></p>
    </>
  );
}
