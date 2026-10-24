"use client";

import { Download, Share } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Popover } from "./ui";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

// Chromium fires `beforeinstallprompt` once, often before any button mounts, so keep it here.
let deferredPrompt: InstallPromptEvent | null = null;
const INSTALLABLE = "canvasme:installable";

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

/** Registers the service worker and offers a reload when a new version is ready. Mounted once in the root layout. */
export function PwaRegister() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const userAsked = useRef(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e as InstallPromptEvent;
      window.dispatchEvent(new Event(INSTALLABLE));
    };
    const onInstalled = () => {
      deferredPrompt = null;
      window.dispatchEvent(new Event(INSTALLABLE));
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

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
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
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

/** "Install app": the native prompt where supported, Add to Home Screen steps on iOS, hidden once installed. */
export function InstallButton({ className = "" }: { className?: string }) {
  const [mode, setMode] = useState<"hidden" | "prompt" | "ios">("hidden");

  useEffect(() => {
    const update = () => {
      if (isStandalone()) return setMode("hidden");
      if (deferredPrompt) return setMode("prompt");
      const ios =
        /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /mac/i.test(navigator.userAgent));
      setMode(ios ? "ios" : "hidden");
    };
    update();
    window.addEventListener(INSTALLABLE, update);
    return () => window.removeEventListener(INSTALLABLE, update);
  }, []);

  const label = (
    <>
      <Download size={16} /> <span>Install app</span>
    </>
  );
  const base = `flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-ink-800 shadow-[var(--shadow-hairline)] hover:bg-ink-100 active:scale-[0.98] ${className}`;

  if (mode === "prompt") {
    return (
      <button
        className={base}
        onClick={async () => {
          const p = deferredPrompt;
          if (!p) return;
          await p.prompt();
          await p.userChoice;
          deferredPrompt = null;
          setMode("hidden");
        }}
      >
        {label}
      </button>
    );
  }
  if (mode === "ios") {
    return (
      <Popover title="Install app" align="right" trigger={label} triggerClassName={base}>
        <div className="w-64 text-sm leading-relaxed text-ink-700">
          <p className="font-semibold text-ink-900">Add canvas.me to your Home Screen</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Tap <Share size={14} className="inline align-[-2px]" /> Share in Safari&apos;s toolbar.
            </li>
            <li>Choose Add to Home Screen.</li>
            <li>Tap Add.</li>
          </ol>
        </div>
      </Popover>
    );
  }
  return null;
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
