"use client";

import { Download, Share } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { IconButton, Popover } from "./ui";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// Captured by the inline script in the root layout, which also fires INSTALLABLE when it changes.
type InstallWindow = Window & { __installPrompt?: InstallPromptEvent | null };
const getPrompt = () => (window as InstallWindow).__installPrompt ?? null;
const INSTALLABLE = "canvasme:installable";

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Registers the service worker and offers a reload when a new version is ready. Mounted once in the root layout. */
export function PwaRegister() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const userAsked = useRef(false);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      // Only reload when the user chose to; the first install also changes the controller.
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (userAsked.current) window.location.reload();
      });
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
          reg.addEventListener("updatefound", () => {
            const sw = reg.installing;
            sw?.addEventListener("statechange", () => {
              if (sw.state === "installed" && navigator.serviceWorker.controller) setWaiting(sw);
            });
          });
        })
        .catch(() => {
          // Offline support is an enhancement; the app works without it.
        });
    }
  }, []);

  if (!waiting) return null;
  return (
    <div
      role="status"
      className="fixed bottom-24 left-1/2 z-50 flex w-[calc(100vw-24px)] max-w-sm -translate-x-1/2 items-center gap-3 rounded-full bg-ink-900 py-2 pl-5 pr-2 text-sm text-white shadow-[var(--shadow-soft)] md:bottom-6"
    >
      <span className="flex-1">A new version of canvas.me is ready.</span>
      <button
        onClick={() => {
          userAsked.current = true;
          waiting.postMessage("SKIP_WAITING");
        }}
        className="rounded-full bg-white px-4 py-1.5 font-semibold text-ink-900 hover:bg-accent-50 active:scale-[0.98]"
      >
        Reload
      </button>
    </div>
  );
}

type InstallMode =
  | "installed"
  | "installed-app"
  | "prompt"
  | "ios"
  | "mac-safari"
  | "android"
  | "chromium"
  | "unsupported";

type RelatedNavigator = Navigator & { getInstalledRelatedApps?: () => Promise<unknown[]> };

// Chromium reports the installed app (via manifest related_applications) when viewed in a browser tab.
let installedApp: Promise<boolean> | null = null;
const checkInstalledApp = () =>
  (installedApp ??= ((navigator as RelatedNavigator).getInstalledRelatedApps?.() ?? Promise.resolve([]))
    .then((apps) => apps.length > 0)
    .catch(() => false));

function detectMode(): InstallMode {
  if (isStandalone()) return "installed";
  if (getPrompt()) return "prompt";
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua) || (navigator.maxTouchPoints > 1 && /macintosh/i.test(ua))) return "ios";
  if (/android/i.test(ua)) return "android";
  if (/chrome|chromium|crios|edg\//i.test(ua)) return "chromium";
  if (/macintosh/i.test(ua) && /safari/i.test(ua) && !/firefox/i.test(ua)) return "mac-safari";
  return "unsupported";
}

const HELP: Record<Exclude<InstallMode, "installed" | "prompt">, { title: string; steps: React.ReactNode[] }> = {
  "installed-app": {
    title: "canvas.me is already installed",
    steps: [
      "Open it from your Dock, Launchpad, Start menu or home screen.",
      "In Chrome or Edge you can also click Open in app at the right end of the address bar.",
    ],
  },
  ios: {
    title: "Add canvas.me to your Home Screen",
    steps: [
      <>
        Tap <Share size={14} className="inline align-[-2px]" /> Share in Safari&apos;s toolbar.
      </>,
      "Choose Add to Home Screen.",
      "Tap Add.",
    ],
  },
  "mac-safari": {
    title: "Add canvas.me to your Dock",
    steps: ["In Safari's menu bar, choose File.", "Choose Add to Dock.", "Click Add."],
  },
  android: {
    title: "Install canvas.me",
    steps: ["Open your browser's menu (the three dots).", "Tap Install app or Add to Home screen."],
  },
  chromium: {
    title: "Install canvas.me",
    steps: [
      "Click the install icon at the right end of the address bar.",
      "Or open the browser menu and choose Install canvas.me (in Edge: Apps, then Install this site as an app).",
    ],
  },
  unsupported: {
    title: "Install from another browser",
    steps: [
      "This browser can't install web apps.",
      "Open canvas.me in Chrome, Edge or Safari and use Download app there.",
      "You can keep designing here in the browser in the meantime.",
    ],
  },
};

export type InstallVariant = "pill" | "icon" | "onAccent" | "link";

const VARIANTS: Record<InstallVariant, string> = {
  pill: "h-auto gap-2 rounded-full px-4 py-2 text-sm font-medium text-ink-800 shadow-[var(--shadow-hairline)] hover:bg-ink-100 md:h-auto",
  icon: "h-9 w-9 rounded-full p-0 text-ink-800 shadow-[var(--shadow-hairline)] hover:bg-ink-100 md:h-9 md:w-9",
  onAccent:
    "h-auto gap-2 rounded-full bg-white/10 px-5 py-3 text-[15px] font-semibold text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.3)] hover:bg-white/20 md:h-auto",
  link: "h-auto rounded-none px-0 py-0 text-sm font-medium text-ink-600 hover:bg-transparent hover:text-accent-500 md:h-auto",
};

/**
 * "Download app": opens the native install prompt where the browser offers one, and otherwise
 * shows the steps for this browser. Hidden when canvas.me is already running as an installed app.
 */
export function InstallButton({
  variant = "pill",
  className = "",
  align = "right",
}: {
  variant?: InstallVariant;
  className?: string;
  align?: "left" | "right";
}) {
  const [mode, setMode] = useState<InstallMode>("installed");

  useEffect(() => {
    let alive = true;
    const update = () => {
      const next = detectMode();
      setMode(next);
      // No install prompt in a Chromium browser often means it is installed already.
      if (next !== "installed" && next !== "prompt") {
        void checkInstalledApp().then((yes) => alive && yes && setMode("installed-app"));
      }
    };
    update();
    window.addEventListener(INSTALLABLE, update);
    return () => {
      alive = false;
      window.removeEventListener(INSTALLABLE, update);
    };
  }, []);

  if (mode === "installed") return null;

  const label =
    variant === "icon" ? (
      <Download size={17} />
    ) : (
      <>
        {variant !== "link" && <Download size={variant === "onAccent" ? 17 : 16} />}
        <span>{mode === "installed-app" ? "Open app" : "Download app"}</span>
      </>
    );
  const classes = `${VARIANTS[variant]} active:scale-[0.98] ${className}`;

  if (mode === "prompt") {
    return (
      <IconButton
        title="Download canvas.me as an app"
        className={classes}
        onClick={async () => {
          const p = getPrompt();
          if (!p) return;
          await p.prompt();
          await p.userChoice;
          // A prompt event can only be used once.
          (window as InstallWindow).__installPrompt = null;
          setMode(detectMode());
        }}
      >
        {label}
      </IconButton>
    );
  }

  const help = HELP[mode];
  return (
    <Popover title="Download canvas.me as an app" align={align} trigger={label} triggerClassName={classes}>
      <div className="w-72 text-left text-sm leading-relaxed text-ink-700">
        <p className="font-semibold text-ink-900">{help.title}</p>
        <ol className={`mt-2 space-y-1 ${help.steps.length > 1 && mode !== "unsupported" ? "list-decimal pl-5" : ""}`}>
          {help.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        {mode !== "unsupported" && mode !== "installed-app" && (
          <p className="mt-3 text-xs text-ink-500">It opens in its own window and works offline.</p>
        )}
      </div>
    </Popover>
  );
}

type LaunchParams = { files: { getFile: () => Promise<File> }[] };

/** Files opened with the installed app (manifest file_handlers) arrive here. */
export function useLaunchedFiles(onFile: (file: File) => void) {
  const handler = useRef(onFile);
  useEffect(() => {
    handler.current = onFile;
  });
  useEffect(() => {
    const lq = (window as Window & { launchQueue?: { setConsumer: (cb: (p: LaunchParams) => void) => void } })
      .launchQueue;
    lq?.setConsumer(async ({ files }) => {
      if (files[0]) handler.current(await files[0].getFile());
    });
  }, []);
}
