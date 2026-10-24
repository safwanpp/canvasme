<img src="public/brand/canvasme-mark.svg" alt="" width="56" height="56">

# canvas.me

A free design editor that runs entirely in your browser. Make social posts, slides and posters without an account. Your designs are saved on your own device.

**Live:** [canvasme.setitup.in](https://canvasme.setitup.in) · mirror: [canvasme.pages.dev](https://canvasme.pages.dev)

## Features

- **Editor**: text (16 Google Fonts, bold/italic/underline, alignment, spacing), shapes (rectangle, rounded, circle, triangle, star, hexagon), lines and arrows, image upload (button, drag-and-drop or paste).
- **Editing**: select, marquee and shift-select, move, resize, rotate, snap guides to page and other elements, double-click text editing, group/ungroup, lock, hide, layer order, align to page, undo/redo, copy/paste/duplicate.
- **Pages**: multiple pages per design, page background, zoom and pan.
- **No account**: designs, images and thumbnails are stored in your browser's IndexedDB and saved automatically.
- **Work files**: download a `.canvasme` file (a zip with the design and its images) to back up a design or move it to another computer, then open it again to keep editing.
- **Export**: PNG and JPG at 2×, all pages as a zip, or a multi-page PDF.

## Keyboard shortcuts

| Action | Keys |
| --- | --- |
| Undo / redo | `Ctrl/⌘ Z` / `Ctrl/⌘ Shift Z` |
| Copy, cut, paste, duplicate | `Ctrl/⌘ C`, `X`, `V`, `D` |
| Duplicate | `Alt/⌥ C` |
| Select all | `Ctrl/⌘ A` |
| Group / ungroup | `Ctrl/⌘ G` / `Ctrl/⌘ Shift G` |
| Forward / backward, to front / back | `Ctrl/⌘ ]` `[`, with `Shift` |
| Nudge | Arrow keys, `Shift` for 10 px |
| Zoom in / out / fit | `Ctrl/⌘ +` / `-` / `0`, or `Ctrl/⌘` + scroll |
| Pan | Scroll, or hold `Space` and drag |
| New text box | `T` |
| Duplicate while dragging | Hold `Alt/⌥` as you start the drag |
| Skip snapping while dragging | Hold `Ctrl/⌘` |

## Good to know

Designs live in the browser where you made them. Clearing site data deletes them, and they don't sync between devices. Download a work file to keep anything important.

## Tech

- [Next.js 15](https://nextjs.org) (App Router) as a static export
- [Konva](https://konvajs.org) + [react-konva](https://konvajs.org/docs/react/) for the canvas; the same node description renders the editor and the PNG/JPG/PDF exports (`src/lib/render.ts`)
- [Zustand](https://zustand.docs.pmnd.rs) for editor state and undo history
- [idb-keyval](https://github.com/jakearchibald/idb-keyval) for IndexedDB, [fflate](https://github.com/101arrowz/fflate) for work files, [jsPDF](https://github.com/parallax/jsPDF) for PDF, [zod](https://zod.dev) to validate imported files
- Tailwind CSS v4, lucide icons
- Hosted on Cloudflare Pages

```
src/
  app/               landing (/), dashboard (/app), editor (/app/edit?id=…)
  components/editor/ canvas, toolbars, side panel, autosave and shortcuts
  lib/               document model, storage, rendering, export, work files
  store/             editor and viewport state
docs/spec.md         behaviour spec the editor was built from
```

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # static site in out/
```

Deploy to Cloudflare Pages:

```bash
npm run build && npx wrangler pages deploy out --project-name canvasme --branch main
```

## About

canvas.me is an independent project inspired by browser design tools such as Canva. It contains no Canva code, templates, fonts or assets, and is not affiliated with Canva.
