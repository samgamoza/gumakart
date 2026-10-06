"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

/** Phase 34: Light (Palenke) is the default; a seller can switch this device to the dark console. */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.getAttribute("data-theme") === "dark"), []);
  function toggle() {
    const next = !dark;
    setDark(next);
    if (next) document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    try {
      localStorage.setItem("guma-admin-theme", next ? "dark" : "light");
    } catch {
      /* private mode */
    }
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      title={dark ? "Light theme" : "Dark theme"}
      className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:text-violet-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300"
      data-testid="theme-toggle"
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
