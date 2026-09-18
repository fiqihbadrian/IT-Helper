"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";

export type Theme = "dark" | "light";

/**
 * Dark is the default, so anything other than an explicit `light` reads as dark.
 * The choice lives in localStorage because it is a per-device display
 * preference, not something worth a column in `profiles`. The matching inline
 * script in `app/layout.tsx` applies it before first paint.
 */
function currentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem("theme", theme);
  } catch {
    // Private mode blocks storage; the theme still applies for this page view.
  }
  document
    .querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    .forEach((meta) => meta.setAttribute("content", theme === "light" ? "#ffffff" : "#0d0f12"));
}

export function ThemeToggle({ className }: { className?: string }) {
  // Rendered dark on the server, corrected after mount from the attribute the
  // inline script already set.
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    setTheme(currentTheme());
  }, []);

  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      onClick={() => {
        setTheme(next);
        applyTheme(next);
      }}
      className={cn("btn-ghost p-2", className)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
