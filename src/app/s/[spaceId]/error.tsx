"use client";

import { Button, EmptyState } from "@/components/ui";

export default function SpaceError({ reset }: { error: Error; reset: () => void }) {
  return (
    <EmptyState title="We couldn't load this page" action={<Button onClick={reset}>Try again</Button>}>
      Check your connection. Nothing you entered was saved twice.
    </EmptyState>
  );
}
