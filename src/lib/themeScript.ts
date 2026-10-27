/** Per-browser preference, not design data. */
export const THEME_KEY = "canvasme-theme";

/** Mobile browser chrome colour (<meta name="theme-color">) per theme. */
export const THEME_COLOR = { light: "#f3f4f7", dark: "#0a0e1f" };

/**
 * Runs before first paint (inlined in the /app layout). It only sets the attribute; the
 * ThemeScope component keeps it in sync afterwards. Keep it in step with resolveTheme().
 * Server-safe: no React import here.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_KEY}");if(p==="dark"||(p!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches)){var r=document.documentElement;r.setAttribute("data-theme","dark");r.style.colorScheme="dark";var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++)m[i].setAttribute("content","${THEME_COLOR.dark}")}}catch(e){}})();`;
