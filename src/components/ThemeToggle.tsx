"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { type ThemePref, useThemePref, writePref } from "@/lib/theme";
import { cx, Popover } from "./ui";

const OPTIONS: { id: ThemePref; label: string; Icon: typeof Sun }[] = [
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
  { id: "system", label: "System", Icon: Monitor },
];

/**
 * Light / Dark / System. A segmented control from the sm breakpoint up; on phones a single icon
 * button that opens a small menu, so it fits the editor top bar at 390 px.
 */
export function ThemeToggle({ className, segmentedFrom = "md" }: { className?: string; segmentedFrom?: "sm" | "md" }) {
  const pref = useThemePref();
  const { Icon: Current, label: CURRENT_LABEL } = OPTIONS.find((o) => o.id === pref)!;
  const wide = segmentedFrom === "sm" ? "hidden sm:flex" : "hidden md:flex";
  const narrow = segmentedFrom === "sm" ? "sm:hidden" : "md:hidden";
  return (
    <>
      <div
        role="group"
        aria-label="Theme"
        className={cx(wide, "shrink-0 items-center rounded-full p-0.5 shadow-[var(--shadow-hairline)]", className)}
      >
        {OPTIONS.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            aria-pressed={pref === id}
            aria-label={label}
            title={label}
            onClick={() => writePref(id)}
            className={cx(
              "flex h-7 w-7 items-center justify-center rounded-full text-ink-600 transition-colors hover:text-ink-900",
              pref === id && "bg-accent-fill text-white hover:text-white",
            )}
          >
            <Icon size={14} />
          </button>
        ))}
      </div>
      <div className={cx(narrow, "shrink-0")}>
        <Popover title={`Theme: ${CURRENT_LABEL}`} align="right" trigger={<Current size={16} />}>
          {(close) => (
            <div role="group" aria-label="Theme" className="w-40 text-sm text-ink-800">
              {OPTIONS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={pref === id}
                  onClick={() => {
                    writePref(id);
                    close();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-ink-50"
                >
                  <Icon size={16} />
                  <span className="flex-1">{label}</span>
                  {pref === id && <Check size={14} className="text-accent-500" />}
                </button>
              ))}
            </div>
          )}
        </Popover>
      </div>
    </>
  );
}
