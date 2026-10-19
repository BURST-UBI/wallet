import { useLayoutEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AppearanceToggle() {
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem("burst-appearance") === "dark"; }
    catch { return false; }
  });
  useLayoutEffect(() => {
    // A theme switch is a single state change, not a page-wide color animation.
    document.documentElement.classList.add("theme-switching");
    document.body.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    void document.documentElement.offsetHeight;
    const frame = requestAnimationFrame(() => document.documentElement.classList.remove("theme-switching"));
    try { localStorage.setItem("burst-appearance", dark ? "dark" : "light"); }
    catch { /* Appearance still works when storage is unavailable. */ }
    return () => { cancelAnimationFrame(frame); document.documentElement.classList.remove("theme-switching"); };
  }, [dark]);
  return (
    <Button variant="ghost" size="icon" aria-label={dark ? "Use light appearance" : "Use dark appearance"}
      title={dark ? "Use light appearance" : "Use dark appearance"}
      onClick={() => setDark(value => !value)} className="shrink-0 text-muted-foreground">
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
