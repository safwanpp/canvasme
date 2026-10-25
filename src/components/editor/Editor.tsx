"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Element } from "@/lib/model";
import { renderThumbnail } from "@/lib/render";
import { loadDesign, requestPersistence, saveDesign, saveThumb } from "@/lib/storage";
import { currentPage, useEditor } from "@/store/editor";
import { type Tool, useView } from "@/store/view";
import { addImageFiles, insertText } from "./actions";
import { BottomBar } from "./BottomBar";
import Canvas from "./Canvas";
import { ContextToolbar } from "./ContextToolbar";
import { SidePanel } from "./SidePanel";
import { setTool } from "./ToolStrip";
import { TopBar } from "./TopBar";

const SAVE_DELAY_MS = 500;
const THUMB_DELAY_MS = 2000;

let clipboard: Element[] = [];

/** Debounced write-through of the open design (and its thumbnail) to IndexedDB. */
function useAutosave() {
  useEffect(() => {
    let saveT: ReturnType<typeof setTimeout> | undefined;
    let thumbT: ReturnType<typeof setTimeout> | undefined;
    let dirty = false;
    const view = useView.getState();

    const save = async () => {
      const d = useEditor.getState().design;
      if (!d || !dirty) return;
      dirty = false;
      try {
        await saveDesign(d);
        if (!dirty) view.set({ saveStatus: "saved" });
      } catch {
        view.set({ saveStatus: "error" });
      }
    };

    const unsub = useEditor.subscribe((s, prev) => {
      if (!s.design || !prev.design || s.design === prev.design) return;
      dirty = true;
      view.set({ saveStatus: "saving" });
      clearTimeout(saveT);
      saveT = setTimeout(save, SAVE_DELAY_MS);
      clearTimeout(thumbT);
      thumbT = setTimeout(async () => {
        const d = useEditor.getState().design;
        if (!d) return;
        try {
          await saveThumb(d.id, await renderThumbnail(d));
        } catch {
          // Thumbnail is cosmetic.
        }
      }, THUMB_DELAY_MS);
    });

    const flush = () => {
      clearTimeout(saveT);
      void save();
    };
    window.addEventListener("pagehide", flush);
    return () => {
      unsub();
      window.removeEventListener("pagehide", flush);
      flush();
      clearTimeout(thumbT);
      const d = useEditor.getState().design;
      if (d) renderThumbnail(d).then((b) => saveThumb(d.id, b)).catch(() => {});
    };
  }, []);
}

const TOOL_KEYS: Record<string, Tool> = { v: "select", p: "draw", e: "eraser", r: "shape", l: "line" };

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

function useShortcuts(onNotice: (m: string) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useEditor.getState();
      const view = useView.getState();
      if (isTyping(e.target)) return;
      if (e.code === "Space") {
        if (!view.spaceDown) view.set({ spaceDown: true });
        e.preventDefault();
        return;
      }
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const sel = st.selected;
      const page = currentPage(st);
      const selEls = page?.elements.filter((el) => sel.includes(el.id)) ?? [];

      // Alt/Option + C duplicates. Match the physical key: on macOS Option+C types "ç".
      if (e.altKey && !mod && e.code === "KeyC") {
        if (!sel.length) return;
        e.preventDefault();
        st.duplicate(sel);
      } else if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
      } else if (mod && key === "y") {
        e.preventDefault();
        st.redo();
      } else if (mod && (key === "c" || key === "x")) {
        if (!selEls.length) return;
        e.preventDefault();
        clipboard = structuredClone(selEls);
        if (key === "x") st.remove(sel);
      } else if (mod && key === "d") {
        e.preventDefault();
        st.duplicate(sel);
      } else if (mod && key === "a") {
        e.preventDefault();
        st.select(page?.elements.filter((el) => !el.locked && !el.hidden).map((el) => el.id) ?? []);
      } else if (mod && key === "g") {
        e.preventDefault();
        if (e.shiftKey) st.ungroup(sel);
        else st.group(sel);
      } else if (mod && (e.key === "]" || e.key === "[")) {
        e.preventDefault();
        const up = e.key === "]";
        st.reorder(sel, e.shiftKey ? (up ? "top" : "bottom") : up ? "up" : "down");
      } else if (mod && (key === "=" || key === "+")) {
        e.preventDefault();
        view.zoomTo(view.scale * 1.25);
      } else if (mod && key === "-") {
        e.preventDefault();
        view.zoomTo(view.scale / 1.25);
      } else if (mod && key === "0") {
        e.preventDefault();
        view.requestFit();
      } else if (key === "delete" || key === "backspace") {
        if (!sel.length) return;
        e.preventDefault();
        st.remove(sel);
      } else if (key === "escape") {
        if (view.maskEditId) view.set({ maskEditId: null });
        else if (view.tool !== "select") setTool("select");
        else st.select([]);
      } else if (key.startsWith("arrow") && sel.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
        const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
        const movable = selEls.filter((el) => !el.locked).map((el) => el.id);
        st.update(movable, (el) => ({ x: el.x + dx, y: el.y + dy }), { coalesce: "nudge" });
      } else if (key === "t" && !mod && !e.altKey) {
        void insertText("body");
      } else if (!mod && !e.altKey && TOOL_KEYS[key]) {
        setTool(TOOL_KEYS[key]);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") useView.getState().set({ spaceDown: false });
    };
    const onPaste = async (e: ClipboardEvent) => {
      if (isTyping(e.target)) return;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (files.length) {
        e.preventDefault();
        const warning = await addImageFiles(files);
        if (warning) onNotice(warning);
      } else if (clipboard.length) {
        e.preventDefault();
        useEditor.getState().paste(clipboard);
      }
    };
    const onBlur = () => useView.getState().set({ spaceDown: false });
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("paste", onPaste);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("paste", onPaste);
      window.removeEventListener("blur", onBlur);
    };
  }, [onNotice]);
}

export default function Editor({ id }: { id: string }) {
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const loadedId = useEditor((s) => s.design?.id);

  const onNotice = useCallback((msg: string) => {
    setNotice(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  // Re-load whenever the store doesn't hold this design (route change, or a reset store).
  const needsLoad = loadedId !== id;
  useEffect(() => {
    if (!needsLoad) return;
    let alive = true;
    setState("loading");
    requestPersistence();
    loadDesign(id).then((d) => {
      if (!alive) return;
      if (!d) return setState("missing");
      useEditor.getState().load(d);
      useView.getState().set({ saveStatus: "saved" });
      setState("ready");
    });
    return () => {
      alive = false;
    };
  }, [id, needsLoad]);

  if (state === "missing") {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-ink-50 text-ink-700">
        <p className="text-lg font-semibold">Design not found in this browser</p>
        <p className="max-w-sm text-center text-sm text-ink-500">
          Designs are stored locally. If you made it on another device, open its .canvasme work file instead.
        </p>
        <Link href="/app" className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-600">
          Back to designs
        </Link>
      </div>
    );
  }

  if (state === "loading" || loadedId !== id) {
    return <div className="flex h-dvh items-center justify-center bg-ink-50 text-sm text-ink-500">Opening design…</div>;
  }

  return <EditorLayout onNotice={onNotice} notice={notice} />;
}

function EditorLayout({ onNotice, notice }: { onNotice: (m: string) => void; notice: string | null }) {
  useAutosave();
  useShortcuts(onNotice);
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-ink-50">
      <TopBar onNotice={onNotice} />
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <SidePanel onNotice={onNotice} />
        <main className="flex min-w-0 flex-1 flex-col">
          <ContextToolbar />
          <div className="min-h-0 flex-1">
            <Canvas onNotice={onNotice} />
          </div>
          <BottomBar />
        </main>
      </div>
      {notice && (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-ink-900 px-4 py-2 text-sm text-white shadow-lg"
        >
          {notice}
        </div>
      )}
    </div>
  );
}
