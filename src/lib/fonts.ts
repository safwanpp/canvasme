// Google Fonts available in the text panel. `spec` is the css2 family query.
export const FONTS: { family: string; spec: string }[] = [
  { family: "Inter", spec: "Inter:ital,wght@0,400;0,700;1,400;1,700" },
  { family: "Roboto", spec: "Roboto:ital,wght@0,400;0,700;1,400;1,700" },
  { family: "Montserrat", spec: "Montserrat:ital,wght@0,400;0,700;1,400;1,700" },
  { family: "Poppins", spec: "Poppins:ital,wght@0,400;0,700;1,400;1,700" },
  { family: "Raleway", spec: "Raleway:ital,wght@0,400;0,700;1,400;1,700" },
  { family: "Space Grotesk", spec: "Space+Grotesk:wght@400;700" },
  { family: "Playfair Display", spec: "Playfair+Display:ital,wght@0,400;0,700;1,400;1,700" },
  { family: "Lora", spec: "Lora:ital,wght@0,400;0,700;1,400;1,700" },
  { family: "Merriweather", spec: "Merriweather:ital,wght@0,400;0,700;1,400;1,700" },
  { family: "DM Serif Display", spec: "DM+Serif+Display:ital@0;1" },
  { family: "Oswald", spec: "Oswald:wght@400;700" },
  { family: "Bebas Neue", spec: "Bebas+Neue" },
  { family: "Archivo Black", spec: "Archivo+Black" },
  { family: "Pacifico", spec: "Pacifico" },
  { family: "Dancing Script", spec: "Dancing+Script:wght@400;700" },
  { family: "Caveat", spec: "Caveat:wght@400;700" },
];

export const DEFAULT_FONT = "Inter";

const requested = new Map<string, Promise<void>>();

/** Inject the stylesheet for a family and resolve once its faces are usable by canvas. */
export function ensureFont(family: string): Promise<void> {
  const existing = requested.get(family);
  if (existing) return existing;
  const font = FONTS.find((f) => f.family === family);
  if (!font || typeof document === "undefined") return Promise.resolve();

  const p = new Promise<void>((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `https://fonts.googleapis.com/css2?family=${font.spec}&display=swap`;
    link.onload = () => {
      Promise.all([
        document.fonts.load(`400 16px "${family}"`),
        document.fonts.load(`700 16px "${family}"`),
      ])
        .catch(() => {})
        .then(() => resolve());
    };
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
  requested.set(family, p);
  return p;
}

export const ensureFonts = (families: Iterable<string>) =>
  Promise.all([...new Set(families)].map(ensureFont)).then(() => {});
