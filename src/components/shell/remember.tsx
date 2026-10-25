"use client";

import { useEffect } from "react";
import { rememberSpace } from "@/lib/actions";

/** Stores the last-opened Space so /home returns here. */
export function RememberSpace({ spaceId }: { spaceId: string }) {
  useEffect(() => { rememberSpace(spaceId).catch(() => {}); }, [spaceId]);
  return null;
}
