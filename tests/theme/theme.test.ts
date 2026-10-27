import { describe, expect, it } from "vitest";
import { parsePref, resolveTheme } from "@/lib/theme";
import { THEME_INIT_SCRIPT } from "@/lib/themeScript";

describe("theme", () => {
  it("parses stored values, defaulting to system", () => {
    expect(parsePref("dark")).toBe("dark");
    expect(parsePref("light")).toBe("light");
    expect(parsePref("system")).toBe("system");
    expect(parsePref("nope")).toBe("system");
    expect(parsePref(null)).toBe("system");
  });
  it("resolves system from the media query", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  it("init script reads the same key and is try/catch wrapped", () => {
    expect(THEME_INIT_SCRIPT).toContain('"canvasme-theme"');
    expect(THEME_INIT_SCRIPT).toContain("catch");
  });
});
