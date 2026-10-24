# canvas.me — Editor spec (clean-room)

Behavioral spec for a Canva-style design editor. Observations come from a passive
REA capture of a free Canva editor session; no Canva code, assets, templates or
fonts are used. Everything under "Design" is our own choice.

## Evidence

| ID | What | Notes |
| --- | --- | --- |
| `ev_b6eff75f…1385` | `rea inspect-web-page` on `canva.com/design/<id>/edit`, 6 s | Attach-limited: page was loaded before capture, so network requests were not observed. Accessibility tree, DOM shape and storage names complete. |

## Observations

- **Layout** (accessibility tree): top menubar `Home · File · Resize · Editing · "All changes saved" · Share`;
  editable `Design title` textbox; left `Side Panel` tablist
  `Templates · Elements · Text · Brand · Uploads · Tools · Projects · Apps` with a
  collapse button; bottom bar `Notes · Show timer · Pages · Grid view · Present full screen`
  plus a `Zoom` slider and `Zoom options` combobox.
- **Rendering**: page content is DOM, not a single canvas — 1 `<canvas>`, 39 `<svg>`,
  107 `<p>` / 228 `<span>` holding text runs, 8 `<img>`.
- **Local persistence**: IndexedDB databases named `…-local_editor`,
  `…-local_resource_blobs`, `local_resource_metadata`, `canva-editor-offline`;
  localStorage holds small settings (`editor_doctype_settings`) and analytics keys.
  Session storage empty.

## Inferences

- Save indicator reflects an autosave loop; designs and binary resources are stored
  separately (document vs blob DBs).
- Side panel is a tabbed "insert" surface; per-element options live in a contextual
  toolbar above the page.

## Unknowns

- Document wire format and sync protocol (network not captured).
- Exact snapping thresholds and keyboard map.

## Design (canvas.me)

Scope: core editor only, no account, no Pro features.

- Routes: `/` landing, `/app` dashboard, `/app/[id]` editor.
- Rendering: Konva single canvas (diverges from Canva's DOM rendering; makes
  PNG/JPG/PDF export and thumbnails one code path — `src/lib/render.ts`).
- Model (`src/lib/model.ts`): Design → pages → elements (`text`, `shape`
  [rect/ellipse/triangle/star/hexagon], `line`, `image`). Z-order = array order.
  Grouping via shared `groupId`.
- Storage: IndexedDB — designs, asset blobs, thumbnails in separate DBs (mirrors the
  observed document/blob split). localStorage only for prefs. Autosave debounced.
- Work file `.canvasme`: zip of `manifest.json`, `design.json`, `assets/*`,
  `thumbnail.png`; import validates with zod and always creates a new design.
- Editor UI: top bar (home, title, undo/redo, save status, open file, download),
  left panel tabs `Text · Elements · Uploads · Layers`, contextual toolbar,
  bottom bar with page strip and zoom.
- Interactions: select, marquee, shift-multi-select, move/resize/rotate, snap to page
  and element edges/centers, double-click text editing, copy/paste/duplicate,
  group/ungroup, lock/hide, layer order, align to page, arrow nudge, undo/redo.
- Export: PNG/JPG (current page, or zip of all pages), PDF (all pages, raster).
