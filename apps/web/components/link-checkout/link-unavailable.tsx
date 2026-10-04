import { LinkIcon } from "lucide-react";

export function LinkUnavailable({ title, message, shopName }: { title: string; message: string; shopName?: string | null }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--kart-orange-soft)] text-[color:var(--kart-orange-dark)]">
        <LinkIcon className="h-6 w-6" />
      </span>
      {shopName && <p className="mt-5 text-sm font-semibold text-[color:var(--kart-muted)]">{shopName}</p>}
      <h1 className="mt-1 text-xl font-extrabold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-[color:var(--kart-muted)]">{message}</p>
      <p className="mt-10 text-[11px] text-[color:var(--kart-muted)]">Checkout ng Guma Kart</p>
    </main>
  );
}
