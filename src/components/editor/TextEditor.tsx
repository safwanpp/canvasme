"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import type { TextElement } from "@/lib/model";
import { remapTextRuns } from "@/lib/richText";
import { useEditor } from "@/store/editor";

/** DOM textarea laid over a text element while it is being edited. */
export function TextEditor({ el, scale, origin }: { el: TextElement; scale: number; origin: { x: number; y: number } }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = el.id;

  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.focus();
    ta.select();
  }, []);

  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = "0px";
    ta.style.height = `${ta.scrollHeight}px`;
  });

  const finish = () => {
    const st = useEditor.getState();
    const cur = st.design?.pages.flatMap((p) => p.elements).find((e) => e.id === id);
    st.setEditingText(null);
    if (cur?.type === "text" && !cur.text.trim()) st.remove([id]);
  };

  return (
    <textarea
      ref={ref}
      value={el.text}
      spellCheck={false}
      onChange={(e) => {
        const text = e.target.value;
        // Style runs follow the edit (inserted text takes the style before it).
        useEditor.getState().update([id], (cur) => (cur.type === "text" ? { text, ...remapTextRuns(cur, text) } : {}), { coalesce: `text:${id}` });
      }}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") finish();
      }}
      style={{
        position: "absolute",
        left: origin.x + el.x * scale,
        top: origin.y + el.y * scale,
        width: el.width * scale,
        transform: `rotate(${el.rotation}deg)`,
        transformOrigin: "top left",
        fontFamily: `"${el.fontFamily}"`,
        fontSize: el.fontSize * scale,
        fontWeight: el.bold ? 700 : 400,
        fontStyle: el.italic ? "italic" : "normal",
        textDecoration: el.underline ? "underline" : "none",
        letterSpacing: el.letterSpacing * scale,
        lineHeight: el.lineHeight,
        textAlign: el.align,
        color: el.fill,
        opacity: el.opacity,
        background: "transparent",
        border: "none",
        outline: "1.5px solid var(--color-accent-500)",
        outlineOffset: 2,
        padding: 0,
        margin: 0,
        resize: "none",
        overflow: "hidden",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    />
  );
}
