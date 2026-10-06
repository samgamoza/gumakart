"use client";

import { useEffect, useState } from "react";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function secondsUntilMidnight(): number {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return Math.max(0, Math.floor((end.getTime() - now.getTime()) / 1000));
}

/**
 * Counts down to the buyer's local midnight. Phase 20: the server (UTC) and the phone
 * (Asia/Manila) disagree about "midnight" and about the exact second, which made React
 * throw away the server HTML and re-render the page. So the server and the first client
 * render show a placeholder; counting starts after hydration.
 */
export function useDealCountdown(): string {
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    setSeconds(secondsUntilMidnight());
    const id = window.setInterval(() => setSeconds(secondsUntilMidnight()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (seconds === null) return "--:--:--";

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}
