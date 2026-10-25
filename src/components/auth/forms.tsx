"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { signInAction, signUpAction, sendResetAction, updatePasswordAction } from "@/lib/actions";
import { Button, Field, Input, Notice } from "@/components/ui";

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signInAction, null);
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      {state && !state.ok && <Notice tone="error" title={state.error} />}
      <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <Field label="Password" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
      <div className="flex justify-end -mt-1"><Link href="/forgot" className="text-[14px] text-teal-ink underline underline-offset-4 decoration-teal/30 hover:decoration-teal">Forgot password?</Link></div>
      <Button type="submit" size="lg" full loading={pending}>Sign in</Button>
    </form>
  );
}

export function SignUpForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signUpAction, null);
  const [show, setShow] = useState(false);
  if (state?.ok) {
    return (
      <Notice tone="teal" title="Check your inbox">
        We sent a confirmation link to <strong>{state.data.email}</strong>. Open it on this device to continue.
      </Notice>
    );
  }
  return (
    <form action={action} className="space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />
      {state && !state.ok && <Notice tone="error" title={state.error} />}
      <Field label="Your name" htmlFor="name" hint="This is how people in your Space will see you."><Input id="name" name="name" autoComplete="name" required maxLength={80} /></Field>
      <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <Field label="Password" htmlFor="password" hint="At least 8 characters.">
        <div className="relative">
          <Input id="password" name="password" type={show ? "text" : "password"} autoComplete="new-password" required minLength={8} className="pr-16" />
          <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 h-8 px-2.5 rounded-lg text-[13px] text-ink-2 hover:bg-sunken" aria-pressed={show}>
            {show ? "Hide" : "Show"}
          </button>
        </div>
      </Field>
      <Button type="submit" size="lg" full loading={pending}>Create account</Button>
      <p className="text-[13px] text-muted">By continuing you agree to the <Link className="underline underline-offset-2" href="/terms">Terms</Link> and <Link className="underline underline-offset-2" href="/privacy">Privacy Policy</Link>.</p>
    </form>
  );
}

export function ForgotForm() {
  const [state, action, pending] = useActionState(sendResetAction, null);
  if (state?.ok) return <Notice tone="teal" title="Check your email">If an account exists for that address, a reset link is on its way.</Notice>;
  return (
    <form action={action} className="space-y-4">
      <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
      <Button type="submit" size="lg" full loading={pending}>Send reset link</Button>
    </form>
  );
}

export function ResetForm() {
  const [state, action, pending] = useActionState(updatePasswordAction, null);
  return (
    <form action={action} className="space-y-4">
      {state && !state.ok && <Notice tone="error" title={state.error} />}
      <Field label="New password" htmlFor="password" hint="At least 8 characters."><Input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} /></Field>
      <Button type="submit" size="lg" full loading={pending}>Save password</Button>
    </form>
  );
}
