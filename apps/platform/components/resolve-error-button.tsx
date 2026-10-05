"use client";

import { useTransition } from "react";
import { resolveAppErrorAction } from "@/app/actions";

export function ResolveErrorButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => void (await resolveAppErrorAction(id)))}
      className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
    >
      {pending ? "…" : "Mark fixed"}
    </button>
  );
}
