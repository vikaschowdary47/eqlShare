import { ButtonLink, EqualsArt, Logo } from "@/components/ui";

export default function NotFound() {
  return (
    <main className="min-h-dvh grid place-items-center px-5 text-center">
      <div className="rise">
        <Logo />
        <div className="mt-12 flex justify-center"><EqualsArt /></div>
        <h1 className="mt-6 text-[34px] font-semibold tracking-[-0.04em]">This page doesn't add up</h1>
        <p className="mt-2 text-muted">The link may be old, or the page moved.</p>
        <ButtonLink href="/home" size="lg" className="mt-8">Go to my Spaces</ButtonLink>
      </div>
    </main>
  );
}
