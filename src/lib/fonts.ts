type Face = { file: string; weight: string; style: "normal" | "italic" };

/**
 * Fonts in the text panel. `spec` is a Google Fonts css2 family query; `faces` are
 * self-hosted files in /public/fonts/ml (free Malayalam fonts, licenses alongside).
 */
export type Font = { family: string; script?: "malayalam"; spec?: string; faces?: Face[] };

const f = (file: string, weight: string, style: Face["style"] = "normal"): Face => ({ file, weight, style });

export const FONTS: Font[] = [
  { family: "Inter", spec: "Inter:ital,wght@0,400;0,700;1,400;1,700" },
  { family: "Geist", spec: "Geist:wght@400;700" },
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

  // Malayalam, from Google Fonts
  { family: "Noto Sans Malayalam", script: "malayalam", spec: "Noto+Sans+Malayalam:wght@400;700" },
  { family: "Noto Serif Malayalam", script: "malayalam", spec: "Noto+Serif+Malayalam:wght@400;700" },
  { family: "Manjari", script: "malayalam", spec: "Manjari:wght@400;700" },
  { family: "Gayathri", script: "malayalam", spec: "Gayathri:wght@400;700" },
  { family: "Chilanka", script: "malayalam", spec: "Chilanka" },
  { family: "Baloo Chettan 2", script: "malayalam", spec: "Baloo+Chettan+2:wght@400;700" },
  { family: "Anek Malayalam", script: "malayalam", spec: "Anek+Malayalam:wght@400;700" },
  { family: "Arima", script: "malayalam", spec: "Arima:wght@400;700" },
  { family: "Google Sans", script: "malayalam", spec: "Google+Sans:ital,wght@0,400;0,700;1,400;1,700" },

  // Malayalam, self-hosted: Swathanthra Malayalam Computing, Lohit, Rachana Institute of Typography
  { family: "Rachana", script: "malayalam", faces: [f("rachana-400.woff2", "400"), f("rachana-700.woff2", "700")] },
  { family: "Meera", script: "malayalam", faces: [f("meera.woff2", "400")] },
  { family: "Karumbi", script: "malayalam", faces: [f("karumbi.woff2", "400")] },
  { family: "Dyuthi", script: "malayalam", faces: [f("dyuthi.woff2", "400")] },
  { family: "Anjali Old Lipi", script: "malayalam", faces: [f("anjali-old-lipi.woff2", "400")] },
  { family: "Lohit Malayalam", script: "malayalam", faces: [f("lohit-malayalam.woff2", "400")] },
  { family: "Malini", script: "malayalam", faces: [f("malini.woff2", "100 900")] },
  { family: "Nupuram", script: "malayalam", faces: [f("nupuram-400.woff2", "400"), f("nupuram-700.woff2", "700"), f("nupuram-400i.woff2", "400", "italic"), f("nupuram-700i.woff2", "700", "italic")] },
  { family: "Nupuram Condensed", script: "malayalam", faces: [f("nupuram-condensed-400.woff2", "400"), f("nupuram-condensed-700.woff2", "700")] },
  { family: "Nupuram Expanded", script: "malayalam", faces: [f("nupuram-expanded-400.woff2", "400"), f("nupuram-expanded-700.woff2", "700")] },
  { family: "Nupuram Sharp", script: "malayalam", faces: [f("nupuram-sharp.woff2", "400")] },
  { family: "Nupuram SuperSoft", script: "malayalam", faces: [f("nupuram-supersoft.woff2", "400")] },
  { family: "Nupuram Display", script: "malayalam", faces: [f("nupuram-display.woff2", "400")] },
  { family: "Nupuram Calligraphy", script: "malayalam", faces: [f("nupuram-calligraphy.woff2", "100 900")] },
  { family: "Nupuram Dots", script: "malayalam", faces: [f("nupuram-dots.woff2", "400")] },
  { family: "RIT Ala", script: "malayalam", faces: [f("rit-ala.woff2", "400")] },
  { family: "RIT Chingam", script: "malayalam", faces: [f("rit-chingam.woff2", "400")] },
  { family: "RIT Ezhuthu", script: "malayalam", faces: [f("rit-ezhuthu.woff2", "400")] },
  { family: "RIT Indira", script: "malayalam", faces: [f("rit-indira.woff2", "400 700")] },
  { family: "RIT Karuna", script: "malayalam", faces: [f("rit-karuna.woff2", "400 700")] },
  { family: "RIT Keraleeyam", script: "malayalam", faces: [f("rit-keraleeyam-400.woff2", "400"), f("rit-keraleeyam-400i.woff2", "400", "italic")] },
  { family: "RIT Keram", script: "malayalam", faces: [f("rit-keram.woff2", "400 700")] },
  { family: "RIT Kutty", script: "malayalam", faces: [f("rit-kutty.woff2", "400 700")] },
  { family: "RIT Lasya", script: "malayalam", faces: [f("rit-lasya.woff2", "400")] },
  { family: "RIT Lekha", script: "malayalam", faces: [f("rit-lekha.woff2", "400")] },
  { family: "RIT Meera New", script: "malayalam", faces: [f("rit-meera-new.woff2", "400")] },
  { family: "RIT Panmana", script: "malayalam", faces: [f("rit-panmana.woff2", "400")] },
  { family: "RIT Rachana", script: "malayalam", faces: [f("rit-rachana-400.woff2", "400"), f("rit-rachana-700.woff2", "700"), f("rit-rachana-400i.woff2", "400", "italic"), f("rit-rachana-700i.woff2", "700", "italic")] },
  { family: "RIT Sundar", script: "malayalam", faces: [f("rit-sundar.woff2", "400")] },
  { family: "RIT Thaara", script: "malayalam", faces: [f("rit-thaara.woff2", "400")] },
  { family: "RIT TN Joy", script: "malayalam", faces: [f("rit-tn-joy-400.woff2", "400"), f("rit-tn-joy-700.woff2", "700")] },
  { family: "RIT Uroob", script: "malayalam", faces: [f("rit-uroob.woff2", "400")] },
];

export const DEFAULT_FONT = "Inter";

const requested = new Map<string, Promise<void>>();

/** Inject the stylesheet for a family and resolve once its faces are usable by canvas. */
export function ensureFont(family: string): Promise<void> {
  const existing = requested.get(family);
  if (existing) return existing;
  const font = FONTS.find((f) => f.family === family);
  if (!font || typeof document === "undefined") return Promise.resolve();

  const p = font.faces ? loadFaces(family, font.faces) : new Promise<void>((resolve) => {
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

function loadFaces(family: string, faces: Face[]): Promise<void> {
  return Promise.all(
    faces.map((face) => {
      const ff = new FontFace(family, `url(/fonts/ml/${face.file}) format("woff2")`, {
        weight: face.weight,
        style: face.style,
        display: "swap",
      });
      document.fonts.add(ff);
      return ff.load().catch(() => {});
    }),
  ).then(() => {});
}

export const ensureFonts = (families: Iterable<string>) =>
  Promise.all([...new Set(families)].map(ensureFont)).then(() => {});
