<img src="public/brand/canvasme-mark.svg" alt="" width="56" height="56">

# canvas.me

A free design editor that runs entirely in your browser. Make social posts, slides and posters without an account. Your designs are saved on your own device.

**Live:** [canvasme.setitup.in](https://canvasme.setitup.in) · mirror: [canvasme.pages.dev](https://canvasme.pages.dev)

## Features

- **Editor**: text (17 Latin fonts plus 48 free Malayalam fonts from Google Fonts, Swathanthra Malayalam Computing, Rachana Institute of Typography and Lohit; bold/italic/underline, alignment, spacing), shapes (rectangle, rounded, circle, triangle, star, hexagon), lines and arrows, a searchable font picker with live previews, image upload (button, drag-and-drop or paste).
- **Tools**: a Canva-style tool strip with select, freehand draw (pen, marker, highlighter, eraser), drag-to-draw shapes and lines, sticky notes and click-to-place text.
- **Uploaded fonts**: add your own TTF, OTF, WOFF or WOFF2 fonts from the font picker. They stay in this browser, work in every design, and travel inside `.canvasme` work files.
- **Background remover**: cut the background out of an image on your device (ormbg model via transformers.js, WebGPU with a CPU fallback). The model downloads once on first use; images never leave the browser.
- **Editing**: select, marquee and shift-select, move, resize, rotate, snap guides to page and other elements, double-click text editing, group/ungroup, lock, hide, layer order, align to page, undo/redo, copy/paste/duplicate.
- **Layer styles**: drop and inner shadow, outer and inner glow, stroke, colour and gradient overlay, every Photoshop blend mode, and fill opacity (outline text, ghost shapes). Effects keep their size when an element is resized.
- **Layers**: nested groups with their own opacity, blend mode and effects; clip an element to the layer below; vector shapes and vector masks; text with several styles in one box.
- **Adjustments and filters**: non-destructive adjustment layers (brightness/contrast, levels, curves, exposure, vibrance, hue/saturation, colour balance, black & white, photo filter, channel mixer, invert, posterize, threshold, gradient map) that change everything below them, plus per-element blur, sharpen, noise and colour filters.
- **Open Photoshop, Illustrator and PDF files**: `.psd` files keep their layers editable: groups, text, layer styles, blend modes, clipping, vector shapes and masks, adjustment layers and smart objects, and each artboard becomes a page. Anything that can't stay editable is listed in per-layer import notes. `.ai` and `.pdf` pages come in as images, with optional editable text on top.
- **Pages**: multiple pages per design, each with its own size if needed, page background, zoom and pan.
- **No account**: designs, images and thumbnails are stored in your browser's IndexedDB and saved automatically.
- **Work files**: download a `.canvasme` file (a zip with the design and its images) to back up a design or move it to another computer, then open it again to keep editing.
- **Export**: PNG and JPG at 2×, all pages as a zip, a multi-page PDF, or a layered `.psd` with editable text, layer styles, groups, clipping, vector shapes and adjustment layers. Multi-page designs can export as one PSD with each page as an artboard.
- **Installable app**: install it from the browser (or Add to Home Screen on iPhone) and it opens in its own window and works offline after the first visit. On Chromium desktop, `.canvasme` files open straight into the installed app.

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
| Tools: select, draw, eraser, shape, line | `V`, `P`, `E`, `R`, `L`; `Esc` back to select |
| Duplicate while dragging | Hold `Alt/⌥` as you start the drag |
| Skip snapping while dragging | Hold `Ctrl/⌘` |

## Good to know

Designs live in the browser where you made them. Clearing site data deletes them, and they don't sync between devices. Download a work file to keep anything important.

## Tech

- [Next.js 15](https://nextjs.org) (App Router) as a static export
- [Konva](https://konvajs.org) + [react-konva](https://konvajs.org/docs/react/) for the canvas; the same node description renders the editor and the PNG/JPG/PDF exports (`src/lib/render.ts`)
- [Zustand](https://zustand.docs.pmnd.rs) for editor state and undo history
- Our own pixel pipeline (`src/lib/fx/`) for layer effects, software blend modes, adjustments and filters, so the editor and every export look the same in every browser
- [idb-keyval](https://github.com/jakearchibald/idb-keyval) for IndexedDB, [fflate](https://github.com/101arrowz/fflate) for work files, [jsPDF](https://github.com/parallax/jsPDF) for PDF, [zod](https://zod.dev) to validate imported files
- [ag-psd](https://github.com/Agamnentzar/ag-psd) to read and write PSD files (parsing runs in a web worker), [pdf.js](https://mozilla.github.io/pdf.js/) for AI and PDF pages
- [Vitest](https://vitest.dev) with jsdom and node-canvas for tests, including PSD write→read round trips
- Tailwind CSS v4, lucide icons
- Hosted on Cloudflare Pages

```
src/
  app/               landing (/), dashboard (/app), editor (/app/edit?id=…)
  components/editor/ canvas, toolbars, side panel, autosave and shortcuts
  lib/               document model, storage, rendering, export, work files
  lib/fx/            effects, blending, adjustments and filters (pure TypeScript)
  lib/importers/     PSD, AI and PDF import; PSD export
  store/             editor and viewport state
tests/               Vitest suites (model, rendering, effects, import, export)
docs/spec.md         behaviour spec the editor was built from
docs/plans/          implementation plans
```

## Run locally

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # static site in out/, then generates out/sw.js
npm test           # Vitest suites
npm run typecheck  # tsc --noEmit
npm run lint
```

Deploy to Cloudflare Pages:

```bash
npm run build && npx wrangler pages deploy out --project-name canvasme --branch main
```

## About

canvas.me is an independent project inspired by browser design tools such as Canva. It contains no Canva code, templates, fonts or assets, and is not affiliated with Canva.
