import { useSyncExternalStore } from "react";
import { THEME_KEY } from "./themeScript";

export type ThemePref = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const EVENT = "canvasme:theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function resolveTheme(pref: ThemePref, systemDark: boolean): ResolvedTheme {
  return pref === "dark" || (pref === "system" && systemDark) ? "dark" : "light";
}

export function parsePref(raw: string | null | undefined): ThemePref {
  return raw === "light" || raw === "dark" ? raw : "system";
}

export function readPref(): ThemePref {
  try {
    return parsePref(localStorage.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

export function writePref(pref: ThemePref) {
  try {
    if (pref === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, pref);
  } catch {
    // Private mode or blocked storage: the choice still applies until reload.
  }
  memory = pref;
  window.dispatchEvent(new Event(EVENT));
}

let memory: ThemePref | null = null;
const currentPref = () => memory ?? readPref();

function subscribePref(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_KEY || e.key === null) {
      memory = null;
      cb();
    }
  };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", onStorage);
  };
}

function subscribeSystem(cb: () => void) {
  const mq = window.matchMedia(DARK_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** The single place that decides light or dark right now, from the real stored values. */
export function getResolvedTheme(): ResolvedTheme {
  return resolveTheme(currentPref(), window.matchMedia(DARK_QUERY).matches);
}

/** Subscribe to anything that can change the resolved theme (preference, other tab, OS). */
export function subscribeTheme(cb: () => void) {
  const offs = [subscribePref(cb), subscribeSystem(cb)];
  return () => offs.forEach((off) => off());
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribePref, currentPref, () => "system");
}

export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(subscribeTheme, getResolvedTheme, () => "light");
}
