# PSD Fidelity and Layer Effects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task is sized for one implementation subagent plus one reviewer. Task IDs (`P1.3`) are stable; refer to them in commits and reviews.

**Goal:** Open .psd files with their layer effects, blend modes, fill opacity, groups, clipping, vector shapes, rich text, adjustment layers and artboards intact and editable, let users create and edit the same effects in canvas.me, and write them back to .psd. Anything that can't stay editable is baked into the layer's pixels and listed in an import note.

**Architecture:** A pure-TypeScript pixel pipeline (`src/lib/fx/*`) renders effects, blend modes, filters and adjustments on RGBA buffers. A single custom Konva `Shape` ("fx shape") produced by `render.ts elementNodes()` draws an element through that pipeline whenever it needs it, so the editor and every export draw the same pixels. Model additions are optional zod fields, plus new element types (`group`, `vector`, `adjustment`) that sit in the existing flat `page.elements` array, linked by `groupId`. PSD mapping lives in two pure modules (read and write) that run in the worker and in tests.

**Tech Stack:** Next.js 15, React 19, TypeScript strict, Konva 9.3 / react-konva 19, zustand 5, zod 3, idb-keyval, ag-psd 31.0.3 (Web Worker). New dev deps: vitest, jsdom, canvas (node-canvas, which Konva's node entry `lib/index-node.js` requires).

**Spec:** this document plus the user brief: "Build features for adapting/importing .psd file. Not only adapting, but we also need to generate the effects and all from our app." Scope: everything, delivered in phases. Policy for unsupported effects: bake them into the pixels, keep supported ones editable, and show an import note. Project constraints are in `docs/spec.md` (clean-room) and CLAUDE.md.

## User decisions (2026-10-25)

These override anything below that disagrees.

1. **Artboards: per-page sizes.** `Page` gains optional `width`/`height` in `src/lib/model.ts` (positive numbers; `undefined` = fall back to `design.width`/`design.height`). Everything that reads the page size (renderer, canvas, exports, thumbnails) goes through one helper `pageSize(design, page)`. Imported artboards keep their own sizes; there is no "largest artboard" fallback. See P5.4 and P6c.
2. **Vector shapes: no point/bezier editing tool now.** Vector elements are editable for fill, stroke and resize only. A knot/handle editing tool is out of scope (future). See P4.4.
3. **Rich text: keep and render style runs; toolbar edits apply to the whole box.** Selecting a word or range to restyle it is out of scope (future). See P4.6.
4. **No real PSD samples.** Calibration (P3.6), the gradient `Lctn`/`Intr` check and the bezier knot-order check use generated fixtures only. Checks that need a real Photoshop-made file are marked "deferred: needs real Photoshop file" and do not block any task.
5. **P0 findings win over older mapping text.** The P3 tables use ag-psd's already-normalized values (gradient `location`/`midpoint` 0..1, `scale`/`offset` fractions), `choke.value / 100`, `Points × dpi/72`, and export always writes `enabled` explicitly (`enabled: true` for active effects).

## Global Constraints

- Clean-room: write original code. Do not copy source from Photoshop SDKs, GIMP, Photopea, Krita or any other editor. Public formulas (W3C compositing spec blend equations, the Felzenszwalb–Huttenlocher distance transform, box-blur Gaussian approximation) are fine to implement from their descriptions.
- Local-first: no server and no new network calls. Everything runs in the browser, and PSD parsing stays in the worker.
- Colours in the model are hex only (`/^#[0-9a-fA-F]{3,8}$/`). Gradients are arrays of hex stops, never CSS strings.
- Every new model field is `.optional()` (or `.default()` only where `normalize` also fills it), because `storage.ts` loads designs without a zod parse. Read paths must treat `undefined` as "off".
- `Design.safeParse` strips unknown keys, so every persisted field must be in the zod schema or `.canvasme` files will silently lose it.
- `FORMAT_VERSION` goes 1 → 2 in P1.1 and 2 → 3 in P4.1. A newer file opened in an older app shows the existing "made with a newer version" error.
- Raster caps match the current Rasterize limits: never allocate a buffer larger than 4096 px on a side or 16,000,000 px in total. Reduce the pixel ratio instead.
- Performance target: dragging an element whose fx render is cached adds no pipeline work (translation is not part of the cache key).
- `package.json` gains scripts `"test": "vitest run"`, `"test:watch": "vitest"` and `"typecheck": "tsc --noEmit"`. Every task ends with `npm run typecheck && npm test && npm run lint` all green.
- Commit messages use the repo style `feat(editor): …` / `feat(import): …` / `test: …`.

## Review Focus

1. **Old designs in IndexedDB** have no `effects`, `blendMode`, `fillOpacity`, `version` or group elements. They must render pixel-identically to today and keep their flat `groupId` groups working after migration. Test: `tests/model/migrate.test.ts` "v1 design migrates with groups and renders unchanged" (P4.1) and `tests/render/fx-shape.test.ts` "element without fx uses plain nodes" (P1.6).
2. **Degenerate geometry.** Text being edited (height 0 before normalize), lines one pixel high, zero-area crop and 0.1 px imported layers must not throw `IndexSizeError` from `getImageData`/`createImageData` with 0 width, and must not render NaN. Test: "zero-size element renders nothing and does not throw" (P1.6).
3. **Huge effect sizes.** A 250 px blur on a 4000 px image must lower the ratio rather than allocate more than 16 M px. Test: "fxRatio caps total pixels" (P1.5).
4. **`.canvasme` round trip.** Effects, blend modes, groups, vectors and adjustments must survive `exportWorkfile` → `importWorkfile`, which runs `Design.safeParse`. Test: "workfile keeps effects" (P1.1) and "workfile keeps tree elements" (P4.1).
5. **Slider drags in the Effects panel** must make one undo step per drag, not one per pixel, including on multi-select. Test: "effect slider coalesces into one history entry" (P2.2).

---

## File Structure

New modules (each one job):

| Path | Responsibility |
|---|---|
| `vitest.config.ts` | Test runner config: `@` alias, node env by default |
| `tests/fixtures/psd.ts` | ag-psd fixture builders (`buildPsd`, `pixelLayer`, `textLayer`, `groupLayer`, `readFixture`) |
| `tests/fixtures/design.ts` | Model factories (`makeDesign`, `rectEl`, `textEl`, `imageEl`) |
| `tests/fixtures/raster.ts` | `Raster` builders and pixel assertions (`solidRaster`, `px`, `expectPx`) |
| `src/lib/fx/raster.ts` | `Raster` type (premultiplied Float32 RGBA) and conversions to and from ImageData/canvas |
| `src/lib/fx/blur.ts` | Gaussian approximation (3× box blur) on one channel |
| `src/lib/fx/distance.ts` | Signed Euclidean distance field from alpha |
| `src/lib/fx/blend.ts` | All PSD blend modes as formulas, the canvas-native mapping, `compositeInto` |
| `src/lib/fx/gradient.ts` | Gradient sampling (5 styles, midpoints, opacity stops) |
| `src/lib/fx/effects.ts` | `renderEffects(content, effects, opts)` → outer parts and body |
| `src/lib/fx/cache.ts` | LRU of fx renders, with a stale lookup by element id |
| `src/lib/fx/readback.ts` | Backdrop readback and `writeBackBlended` for non-native blends and adjustments |
| `src/lib/fx/fxShape.ts` | Konva Shape attrs that run the pipeline (`fxShapeAttrs`, `needsFx`, `fxPadding`) |
| `src/lib/fx/bake.ts` (P3) | Approximations of bevel/emboss, satin, pattern overlay and noise gradients, baked into pixels |
| `src/lib/fx/adjust.ts` (P5) | Adjustment and filter pixel operations (LUTs, HSL, curves spline) |
| `src/lib/effects.ts` | Zod schemas for effects, paint, gradient and blend mode; presets; defaults |
| `src/lib/migrate.ts` | `migrateDesign(raw)` from version 1 to 3, used by store load, storage and workfile |
| `src/lib/tree.ts` (P4) | Tree helpers over the flat array: `buildRenderTree`, `normalizeTree`, `descendants`, `syncGroupBounds` |
| `src/lib/vector.ts` (P4) | Bezier subpath tracing, boolean-op compositing, bounds, scaling |
| `src/lib/richText.ts` (P4) | Rich text layout and drawing for style runs, plus `remapRuns` |
| `src/lib/importers/psdConvert.ts` | Pure `convert()` moved out of the worker so it can be tested |
| `src/lib/importers/psdEffects.ts` | ag-psd ↔ model mapping for effects, blend modes, gradients and units |
| `src/lib/importers/psdStructure.ts` (P4) | Groups, clipping, vector layers, vector masks, text runs, smart objects |
| `src/lib/importers/psdAdjust.ts` (P5) | ag-psd adjustment ↔ model mapping |
| `src/lib/importers/psdBuild.ts` (P6) | Pure `buildPsd(design, page, renderLayer)` → ag-psd `Psd` object |
| `src/components/editor/EffectsPanel.tsx` (P2) | Effects popover UI |
| `src/components/editor/ImportNotes.tsx` (P3) | Persistent import-notes panel |
| `src/components/editor/GroupNode.tsx` (P4) | Renders group and clip-stack containers (isolated via Konva cache) |
| `src/components/editor/AdjustmentPanel.tsx` (P5) | Adjustment editors |

Modified across phases: `package.json`, `src/lib/model.ts`, `src/lib/render.ts`, `src/components/editor/ElementNode.tsx`, `src/components/editor/Canvas.tsx`, `src/components/editor/ContextToolbar.tsx`, `src/components/editor/SidePanel.tsx`, `src/components/ImportStatus.tsx`, `src/store/editor.ts`, `src/lib/storage.ts`, `src/lib/workfile.ts`, `src/lib/importers/{psd.ts,psd.worker.ts,psdExport.ts,job.ts}`, `src/components/editor/actions.ts`, `src/lib/mask.ts`.

## Phase dependency graph

```
P0 ─► P1 ─┬─► P2
          ├─► P3 ─┬─► P6a (effects/blend/fill/text export)
          │       └─► P4 ─┬─► P6b (groups/clipping/vectors export)
          │               └─► P5 ─► P6c (adjustments export)
```

P2 and P3 can run in parallel after P1. P6 is split so that each export slice ships right after the import slice it mirrors. Every phase is independently shippable: it builds, it's tested, and the UI either works or isn't exposed yet.

---

# Phase 0: Foundation (test infrastructure and fixtures)

**Goal:** A working `npm test` and `npm run typecheck`, plus fixture builders that create PSDs in code. No binary fixtures.

### Task P0.1: Vitest, jsdom, node-canvas and scripts

**Files:**
- Modify: `package.json` (devDeps `vitest@^3`, `jsdom@^25`, `canvas@^3`; scripts `test`, `test:watch`, `typecheck`)
- Create: `vitest.config.ts`
- Create: `tests/smoke.test.ts`
- Modify: `tsconfig.json` only if `tests/**` needs `"types": ["vitest/globals"]` (prefer explicit imports from `vitest` and leave tsconfig alone)

**Interfaces:**
- Produces: the `npm test` and `npm run typecheck` scripts. Tests live under `tests/**/*.test.ts`. The default environment is `node`; a file opts into the DOM with a `// @vitest-environment jsdom` docblock.

- [ ] **Step 1:** Install with `npm i -D vitest jsdom canvas`, add the scripts, and write `vitest.config.ts` with `resolve.alias: { "@": path.resolve(__dirname, "src") }`, `test.include: ["tests/**/*.test.ts"]` and `test.environment: "node"`.
- [ ] **Step 2: Write the smoke tests.** `tests/smoke.test.ts`:
  - "konva renders in jsdom" (`@vitest-environment jsdom`): create a `Konva.Stage` with a `div` container, add a red `Rect`, then `stage.toCanvas().getContext("2d").getImageData(1,1,1,1).data` deep-equals `[255,0,0,255]`.
  - "ag-psd round-trips a layer": `writePsd` a 2×2 opaque layer from `imageData`, `readPsd(buf, { useImageData: true })`, and expect `children[0].imageData.width === 2`.
- [ ] **Step 3:** Run `npm test`, `npm run typecheck` and `npm run lint`. Expect all green. If `canvas` fails to install on darwin-arm64, stop and report. Do not switch to `@napi-rs/canvas`, because Konva's node entry `require("canvas")`s by name.
- [ ] **Step 4:** Commit with `test: add vitest, jsdom and node-canvas`.

### Task P0.2: Fixture builders

**Files:**
- Create: `tests/fixtures/psd.ts`, `tests/fixtures/design.ts`, `tests/fixtures/raster.ts`
- Test: `tests/fixtures/fixtures.test.ts`

**Interfaces:**
- Produces:
  - `pixelLayer(o: { name?: string; left?: number; top?: number; w: number; h: number; rgba?: [number,number,number,number]; extra?: Partial<Layer> }): Layer` (solid colour, `imageData` filled)
  - `textLayer(o: { text: string; left: number; top: number; fontSize?: number; font?: string; color?: string; runs?: TextStyleRun[]; extra?: Partial<Layer> }): Layer`
  - `groupLayer(name: string, children: Layer[], extra?: Partial<Layer>): Layer`
  - `buildPsd(children: Layer[], o?: { width?: number; height?: number; extra?: Partial<Psd> }): ArrayBuffer`. Writes a composite `imageData` (a flat grey is fine), uses `noBackground: true`, and defaults to 200×200.
  - `readFixture(buf: ArrayBuffer): Psd`, which is `readPsd(buf, { useImageData: true, skipThumbnail: true })`
  - `makeDesign(els: Element[], o?: { width?: number; height?: number; background?: string }): Design`, plus `rectEl(p?: Partial<ShapeElement>)`, `textEl(p?)`, `imageEl(p?)` with all base fields filled in
  - `solidRaster(w, h, rgba: [r,g,b,a] /*0..1, straight*/): Raster`, `px(r: Raster, x, y): [r,g,b,a] /* straight 0..255 rounded */`, `expectPx(actual, expected, tol = 2)`
- Consumes: the `Raster` type from P1.2. Until P1.2 lands, define `raster.ts` against a local `type Raster = { w: number; h: number; data: Float32Array }`, then re-point it to `@/lib/fx/raster` in P1.2.

- [ ] **Step 1: Write the tests** in `tests/fixtures/fixtures.test.ts`:
  - "buildPsd keeps effects": a pixel layer with `extra.effects = { dropShadow: [{ enabled: true, size: { units: "Pixels", value: 8 }, distance: { units: "Pixels", value: 5 }, angle: 120, color: { r: 0, g: 0, b: 0 }, opacity: 0.75, blendMode: "multiply" }] }` reads back with `children[0].effects.dropShadow[0].size.value === 8` and `blendMode === "multiply"`.
  - "buildPsd keeps text runs": a text layer with two `styleRuns` reads back with `text.styleRuns.length === 2`.
  - "buildPsd keeps nesting": `groupLayer("A", [groupLayer("B", [pixelLayer(...)])])` reads back two levels deep.
- [ ] **Step 2:** Implement the builders. Run `npm test`. Expect PASS. If a field doesn't survive ag-psd's write→read, record it in a comment at the top of `tests/fixtures/psd.ts`. That list tells P3 which mappings can only be tested via the `convert()` input object and not via binary round trips.
- [ ] **Step 3:** Commit with `test: psd, design and raster fixture builders`.

### P0 findings (ag-psd 31.0.3, confirmed by `tests/fixtures/fixtures.test.ts` "ag-psd units")

Later phases rely on these. Where a finding contradicts a table elsewhere in this plan, the finding wins.

- **Setup deviations.** `jsdom@^25` peers `canvas@^2`, which conflicts with `canvas@^3`, so P0.1 uses `jsdom@^26` (it peers `canvas@^3`). In the node test environment, ag-psd needs `initializeCanvas` before `readPsd` decodes pixels. `tests/fixtures/psd.ts` calls it with node-canvas, the way the worker uses OffscreenCanvas.
- **Choke** (drop/inner shadow, outer/inner glow) is a `UnitsValue` whose `value` is the percent 0..100, written with `units: "Pixels"`. ag-psd's writer throws on `units: "Percent"`. The mapping `choke.value / 100 → spread|choke` is correct; ignore `choke.units`.
- **Gradient stops.** ag-psd already normalizes, so `location` is 0..1 (file `Lctn / Intr`, where `Intr = smoothness × 4096`) and `midpoint` is 0..1 (file `Mdpn / 100`). **Don't divide again.** The P3 table uses ag-psd's values as they are. The model takes ag-psd's numbers as they are, and the named constant is `AG_PSD_LOCATION_SCALE = 1`. Quantization: location to 1/4096 at smoothness 1, midpoint to whole percent. Opacity stops' `opacity` is 0..1.
  - *Unverified risk:* ag-psd divides `Lctn` by `Intr`, not by 4096. If Photoshop stores `Lctn` on 0..4096 regardless of smoothness, stops from a real file with smoothness under 100% would come in scaled by `4096/Intr`. P3.6 covers this with generated fixtures only; the real-file check is **deferred: needs real Photoshop file**.
- **Percent fields are already fractions:** `gradientOverlay.scale`, `gradientOverlay.offset.{x,y}`, `stroke.gradient.scale`, `patternOverlay.scale`, `effects.scale` (defaults to 1 on read) and every effect `opacity` (rounded to whole percent on write). No `/100` on any of these (the P3 tables reflect this).
- **Layer opacity and fillOpacity** are 0..1 and both round to 1/255. Blend mode strings come through verbatim (`"linear dodge"`, `"subtract"`, `"darker color"`, …).
- **`enabled`:** an effect written without `enabled` reads back `enabled: false`. P6a export must always write `enabled: true` explicitly.
- **Units** come through as-is. `Points` stays `Points`, and ag-psd never converts to pixels, so `unitsToPx` must apply dpi/72.
- **Global light:** `useGlobalLight` and `imageResources.globalAngle` both survive.
- **Contour** `curve` points are `{x, y}` in 0..255 and survive exactly.
- **Bezier knots:** `points` is 6 numbers in **document pixels** (ag-psd multiplies by the document width and height), kept in array order through write → read, with an error of about 1e-5 px on a 200 px document. ag-psd writes them as file pairs 0, 1, 2 in order. By the PSD spec a knot record is (preceding control point, anchor, leaving control point), so `points = [inX, inY, x, y, outX, outY]`. A round trip can't prove that semantic order, because ag-psd doesn't render paths. P4.5 uses this order with generated fixtures; confirming it against a Photoshop-made shape (the anchor sits on the visible corner) is **deferred: needs real Photoshop file**. `open`, `operation`, `fillRule` and `linked` survive.
- **Patterns** live on `Psd.patterns` (document level, from the `Patt`/`Pat2`/`Pat3` additional info), not on the layer. Effects reference them by `pattern.id`. Writing them works for RGB 8-bit.
- **Text:** `text.text` and `styleRuns` survive. Nested groups survive at any depth.

---

# Phase 1: Effects model and renderer

**Goal:** Every element type can carry `effects`, `blendMode` and `fillOpacity`. The editor and all exports draw them identically. Selection boxes stay on the element box, while rasterize and export include the effect padding.

### Rendering design (decided)

- **When the fx path runs.** `needsFx(el)` is true when any of these hold: there is at least one enabled effect, `blendMode` is non-native (see the table below), `filters` is non-empty (P5), or `vectorMask` is set (P4). In that case `elementNodes()` returns a single `{ kind: "Shape", attrs: fxShapeAttrs(...) }` and no plain nodes. Otherwise it returns today's nodes unchanged. Native blend modes without effects are set as `globalCompositeOperation` on the element's Konva Group via `groupAttrs`. Fill opacity without effects is multiplied into `opacity` in `groupAttrs`; that is exactly equivalent when there is nothing to keep unfaded.
- **Content raster.** `fxShapeAttrs` builds the element's plain nodes (`baseNodes(el, image)`, today's `elementNodes` body renamed) into a detached `Konva.Group`. It calls `group.toCanvas({ x: -pad.l, y: -pad.t, width: w + pad.l + pad.r, height: h + pad.t + pad.b, pixelRatio: ratio })` and converts the result to a `Raster`. Line, path and shape strokes and arrow heads reach past the box, so the base pad is `max(2, strokeWidth * 1.5)` for line, path and stroked shapes and 2 otherwise. On top of that comes the effect pad from `fxPadding`.
- **Ratio.** In `sceneFunc` read `ctx._context.getTransform()` and take `s = Math.hypot(a, b)` (device pixels per element unit). Quantize to the nearest step of `2^(k/2)` and clamp to the caps in Global Constraints, using `fxRatio(s, paddedW, paddedH)`.
- **Pipeline** (`renderEffects`). Everything is premultiplied Float32 in device pixels, and effect sizes are multiplied by the ratio. The output is `{ outer: Part[]; body: Raster }` with `Part = { raster: Raster; blend: BlendMode; opacity: number }`, drawn bottom to top:
  1. `outer`: drop shadows (in array order, bottom first), then outer glow. They are drawn straight onto the scene context, each with its own blend, so a multiply shadow multiplies with what is below the element.
  2. `body`, built offscreen in Photoshop's order: content × fillOpacity, then gradient overlays, then colour overlays, then inner glow, then inner shadows, then strokes. Each interior effect is masked by the **unfaded** content alpha `A` and composited onto the body with its own blend via `compositeInto`. Strokes are not masked by `A`; their own region defines them. The finished body is drawn onto the scene with the element's blend mode. The element's `opacity` (Konva group opacity) applies to outer and body alike.
- **Effect geometry** (σ is the Gaussian sigma, d the signed distance in device px, negative inside and positive outside):
  - Blur radius: `σ = size * SIZE_TO_SIGMA` with `SIZE_TO_SIGMA = 0.5` (one exported constant in `effects.ts`, tuned visually in P3.6).
  - Spread (drop shadow, outer glow): `dil = size * spread`. Shadow alpha = blur(clamp01(dil − d + 0.5), σ·(1 − spread)). Offset `dx = −cos(angle°)·distance`, `dy = sin(angle°)·distance` (angle is the light direction; 120° casts down and right).
  - Choke (inner shadow, inner glow): `ch = size * choke`. Inverse alpha `I = 1 − A`, eroded by `ch` with the same distance-field trick on `I`, then blurred with σ·(1 − choke), offset for inner shadow, then multiplied by `A`.
  - Inner glow `source: "center"`: use `A` eroded and blurred (not `I`), so the glow sits at the centre.
  - Glow `technique: "precise"`: replace the blur with `clamp01(1 − d_out / size)` from the distance field.
  - Stroke of width `s`: `outside` covers `0 < d ≤ s`, `inside` covers `−s ≤ d < 0` and `center` covers `|d| ≤ s/2`. Coverage is antialiased as `clamp01(edge − |d| + 0.5)` at each boundary. Fill the stroke with its Paint: a colour, or a gradient sampled over the element box.
  - `knockout` (drop shadow `layerConceals`, default true): multiply shadow alpha by `1 − A·fillOpacity'`, where fillOpacity' is 1 when fillOpacity < 1 (Photoshop hides the shadow under the layer even when the fill is faded).
  - Contour (optional curve): a LUT over 256 alpha levels applied after the blur. Linear by default.
- **Distance field.** Threshold `A` at 0.5, then run the exact 2-pass 1D squared Euclidean distance transform (Felzenszwalb–Huttenlocher, implemented from the paper's description) on the inside and the outside separately. `d = sqrt(outsideDist) − sqrt(insideDist)`, with a subpixel correction `+ (0.5 − A)` at the edges for smooth antialiasing. Compute it only when a stroke, spread, choke or precise glow needs it, and cache it per render.
- **Blur.** Three successive box blurs with radii from the standard "boxes for Gauss" formula. Separable, O(n), running-sum implementation, alpha channel only, Float32.
- **Non-native blend for the element itself** (see the table). In `sceneFunc`, after drawing `outer`, compute the body's device rect `R` from the current transform, intersected with the canvas bounds. Read the backdrop `B` with `getImageData(R)`. Draw the body transformed into a temporary canvas of size R to get `S` with coverage `a = S.alpha × globalAlpha`. Compute `C = blend(B, S)` per pixel (W3C separable/non-separable formulas plus the PSD-only ones below). Write back without `putImageData`, which ignores clip and alpha. Instead:
  (1) `globalCompositeOperation = "destination-out"`, drawImage of a canvas whose alpha is `a`, giving `B·(1−a)`.
  (2) `globalCompositeOperation = "lighter"`, drawImage of the premultiplied `C·a`.
  Both run under an identity transform at R. The result is `B(1−a) + C·a` and it respects the page clip group. This is `writeBackBlended(ctx, R, mask, colour)` in `readback.ts`, and adjustments reuse it in P5.
- **Cache.** Key = `JSON.stringify` of the element without `id`, `x`, `y`, `rotation`, `opacity`, `locked`, `name`, `hidden`, `groupId`, plus the ratio step, plus `assetId` (immutable blobs), plus `fontsVersion`. The value is the rendered `{ outerCanvases, bodyCanvas, pad }` as `HTMLCanvasElement`s. It's an LRU capped at 64 entries and 256 M device px in total. `getStale(id)` returns the last render for an element id; while `useView.transforming` is true, `sceneFunc` draws the stale render stretched to the new box and recomputes on transform end.
- **Bounds.** `fxPadding(el): { l, t, r, b }` in element units (for a drop shadow, `max(0, size·(1+spread)·1.5 + |dx|)` on the relevant sides; for an outside stroke, its size; and so on). `visualBounds(el)` gives the page-space AABB of the rotated padded box. Transformer, snapping and `alignToPage` keep using the element box. Rasterize and PSD export use `visualBounds`.
- **Hit testing.** `hitFunc` traces the element's own outline (`traceShape` for shapes, the box for text and images, the stroked polyline with `hitStrokeWidth` for lines and paths) and never the effects.

### Blend mode table

| Model value (kebab) | PSD `BlendMode` | Canvas `globalCompositeOperation` | Handling |
|---|---|---|---|
| `normal` | `normal` | `source-over` | native |
| `pass-through` | `pass through` | n/a (groups only) | P4 |
| `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color-dodge`, `color-burn`, `hard-light`, `soft-light`, `difference`, `exclusion`, `hue`, `saturation`, `color`, `luminosity` | same names with spaces | same | native |
| `linear-dodge` | `linear dodge` | `lighter` | native (exact for premultiplied add, clamped) |
| `linear-burn` | `linear burn` | none | software: `B + S − 1` |
| `vivid-light` | `vivid light` | none | software: color-burn(2S) when S ≤ .5, else color-dodge(2S−1) |
| `linear-light` | `linear light` | none | software: `B + 2S − 1` |
| `pin-light` | `pin light` | none | software: S ≤ .5 ? min(B, 2S) : max(B, 2S−1) |
| `hard-mix` | `hard mix` | none | software: `vividLight(B,S) < .5 ? 0 : 1` |
| `darker-color` | `darker color` | none | software: pick the whole pixel with lower Lum |
| `lighter-color` | `lighter color` | none | software: pick the whole pixel with higher Lum |
| `subtract` | `subtract` (also `subtraction`) | none | software: `B − S` |
| `divide` | `divide` | none | software: `S = 0 ? 1 : B / S` |
| `dissolve` | `dissolve` | `source-over` | software: alpha thresholded against a seeded hash noise `hash(x,y,id)`; normal otherwise |
| (import only) `linear height`, `height` | | | treated as `normal` plus an import note |

Interior effects are composited offscreen against the body with `compositeInto`, so every mode works there too.

### Task P1.1: Effects schema, base fields and version 2

**Files:**
- Create: `src/lib/effects.ts`
- Create: `src/lib/migrate.ts`
- Modify: `src/lib/model.ts` (spread `fxFields` into `base`; `FORMAT_VERSION = 2`; `Design.version` optional)
- Modify: `src/lib/workfile.ts` (run `migrateDesign` before `Design.safeParse`)
- Modify: `src/lib/storage.ts` (`loadDesign`/`listDesigns` map through `migrateDesign`)
- Modify: `src/store/editor.ts` (`load` calls `migrateDesign`)
- Test: `tests/model/effects-schema.test.ts`, `tests/model/migrate.test.ts`

**Interfaces:**
- Produces (in `src/lib/effects.ts`):

```ts
export const BLEND_MODES = ["normal","pass-through","dissolve","darken","multiply","color-burn","linear-burn","darker-color",
  "lighten","screen","color-dodge","linear-dodge","lighter-color","overlay","soft-light","hard-light","vivid-light",
  "linear-light","pin-light","hard-mix","difference","exclusion","subtract","divide","hue","saturation","color","luminosity"] as const;
export const BlendMode = z.enum(BLEND_MODES);
export const ColorStop = z.object({ offset: z.number().min(0).max(1), color: Color, midpoint: z.number().min(0.05).max(0.95).optional() });
export const OpacityStop = z.object({ offset: z.number().min(0).max(1), opacity: z.number().min(0).max(1), midpoint: z.number().min(0.05).max(0.95).optional() });
export const Gradient = z.object({
  style: z.enum(["linear","radial","angle","reflected","diamond"]).default("linear"),
  stops: z.array(ColorStop).min(2).max(32),
  opacityStops: z.array(OpacityStop).max(32).optional(),
  angle: z.number().default(90),          // degrees, Photoshop convention (90 = bottom→top)
  scale: z.number().min(0.1).max(10).default(1),
  reverse: z.boolean().default(false),
  offset: z.object({ x: z.number(), y: z.number() }).optional(), // fraction of box, -1..1
});
export const Paint = z.discriminatedUnion("type", [
  z.object({ type: z.literal("color"), color: Color }),
  z.object({ type: z.literal("gradient"), gradient: Gradient }),
]);
const fxCommon = { enabled: z.boolean().default(true), blendMode: BlendMode.default("normal"), opacity: z.number().min(0).max(1).default(1) };
export const Contour = z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(2).max(32);
export const Shadow = z.object({ ...fxCommon, color: Color, angle: z.number(), distance: z.number().min(0).max(30000),
  size: z.number().min(0).max(250), spread: z.number().min(0).max(1).default(0), knockout: z.boolean().default(true), contour: Contour.optional() });
export const InnerShadow = Shadow.omit({ spread: true, knockout: true }).extend({ choke: z.number().min(0).max(1).default(0) });
export const Glow = z.object({ ...fxCommon, color: Color, size: z.number().min(0).max(250), spread: z.number().min(0).max(1).default(0),
  technique: z.enum(["softer","precise"]).default("softer"), contour: Contour.optional() });
export const InnerGlow = Glow.omit({ spread: true }).extend({ choke: z.number().min(0).max(1).default(0), source: z.enum(["edge","center"]).default("edge") });
export const StrokeFx = z.object({ ...fxCommon, size: z.number().min(0).max(250), position: z.enum(["inside","center","outside"]).default("outside"), paint: Paint });
export const ColorOverlay = z.object({ ...fxCommon, color: Color });
export const GradientOverlay = z.object({ ...fxCommon, gradient: Gradient, alignWithLayer: z.boolean().default(true) });
export const Effects = z.object({
  dropShadow: z.array(Shadow).max(10).optional(),
  innerShadow: z.array(InnerShadow).max(10).optional(),
  outerGlow: Glow.optional(),
  innerGlow: InnerGlow.optional(),
  stroke: z.array(StrokeFx).max(10).optional(),
  colorOverlay: z.array(ColorOverlay).max(10).optional(),
  gradientOverlay: z.array(GradientOverlay).max(10).optional(),
});
export const fxFields = {
  effects: Effects.optional(),
  blendMode: BlendMode.optional(),        // undefined = normal ("pass-through" only valid on groups, P4)
  fillOpacity: z.number().min(0).max(1).optional(), // undefined = 1
};
export type BlendMode = z.infer<typeof BlendMode>; // plus Gradient, Paint, Effects, Shadow, ... types
export function hasActiveEffects(fx: Effects | undefined): boolean;
```

  Note: `Color` is currently module-private in `model.ts`. Move it to `src/lib/effects.ts` (or a tiny `src/lib/color.ts`) and import it in both files so there is no import cycle. `model.ts` imports from `effects.ts`, never the other way round.
- Produces (in `src/lib/migrate.ts`): `export function migrateDesign(raw: unknown): unknown` (idempotent; sets `version`; P1 only stamps 2; P4.1 adds the 2→3 step) and `export const CURRENT_VERSION = FORMAT_VERSION`.

- [ ] **Step 1: Write the failing tests.**
  - `effects-schema.test.ts` "element with full effects parses": a `rectEl` carrying one of every effect parses with `Element.parse`, and `effects.dropShadow[0].spread` defaults to 0.
  - "rejects non-hex colours in gradients": a stop `color: "red"` fails.
  - "old element without fx fields parses unchanged": `Element.parse(rectEl())` has no `effects` key (an optional field doesn't appear).
  - "workfile keeps effects" (`@vitest-environment jsdom`, mock `./storage` with an in-memory map and mock `renderThumbnail` to reject): `exportWorkfile(design)` → `new File([blob], "x.canvasme")` → `importWorkfile`, and the saved design's element `effects` deep-equals the original.
  - `migrate.test.ts` "stamps version and is idempotent": `migrateDesign(migrateDesign(v1))` deep-equals `migrateDesign(v1)`, with `version === 2`.
- [ ] **Step 2:** Run `npm test -- effects-schema migrate`. Expect FAIL (module not found).
- [ ] **Step 3:** Implement as specified. In `workfile.ts`, call `Design.safeParse(migrateDesign(designJson))`. The manifest check stays `manifest.version > FORMAT_VERSION`.
- [ ] **Step 4:** Run `npm test && npm run typecheck`. Expect PASS.
- [ ] **Step 5:** Commit with `feat(model): layer effects, blend mode and fill opacity schema`.

### Task P1.2: Raster, blur and distance field

**Files:**
- Create: `src/lib/fx/raster.ts`, `src/lib/fx/blur.ts`, `src/lib/fx/distance.ts`
- Test: `tests/fx/blur.test.ts`, `tests/fx/distance.test.ts`

**Interfaces:**
- Produces:
  - `type Raster = { w: number; h: number; data: Float32Array /* premultiplied RGBA 0..1 */ }`
  - `createRaster(w, h): Raster`, `alphaOf(r): Float32Array`, `fromImageData(d: ImageData): Raster`, `toImageData(r): ImageData`, `fromCanvas(c: HTMLCanvasElement | OffscreenCanvas): Raster`, `toCanvas(r): HTMLCanvasElement`. The last two are the only DOM touch points; `toCanvas` uses `document.createElement` and falls back to `OffscreenCanvas` in a worker.
  - `gaussianBlur(ch: Float32Array, w: number, h: number, sigma: number): Float32Array` (sigma ≤ 0.3 returns a copy)
  - `signedDistance(alpha: Float32Array, w: number, h: number): Float32Array`
  - `dilateAlpha(alpha, w, h, r): Float32Array` = `clamp01(r − d + 0.5)` using a precomputed field when one is passed as the optional 5th arg.

- [ ] **Step 1: Write the failing tests.**
  - "blur preserves total mass": blurring a 64×64 single centre pixel with σ = 4 sums to 1 ± 1e-3, and the centre value ≈ `1/(2πσ²)` within 15%.
  - "blur sigma 0 is identity".
  - "distance of a filled 20×20 square in 40×40": `d` at the square's centre ≈ −10 ± 0.6, at (0,0) ≈ +√(10²+10²) ± 0.6, and at the edge midpoint |d| ≤ 0.6.
  - "dilate by 3 grows a 10px square to ~16px": the count of pixels with alpha > 0.5 is within 16²±20.
- [ ] **Step 2:** Run and expect FAIL.
- [ ] **Step 3:** Implement. Box radii for 3 passes: `wIdeal = sqrt(12σ²/3 + 1)` and the standard m-split. The EDT is the 1D lower-envelope-of-parabolas pass over rows then columns. Use `Float32Array` throughout and allocate no arrays per pixel.
- [ ] **Step 4:** Run and expect PASS. Add "blur of 2000×2000 runs under 400 ms" as a `it.skipIf(process.env.CI)` perf smoke test.
- [ ] **Step 5:** Commit with `feat(fx): raster buffers, gaussian blur and distance field`.

### Task P1.3: Blend formulas and gradient sampling

**Files:**
- Create: `src/lib/fx/blend.ts`, `src/lib/fx/gradient.ts`
- Test: `tests/fx/blend.test.ts`, `tests/fx/gradient.test.ts`

**Interfaces:**
- Produces:
  - `NATIVE_BLEND: Partial<Record<BlendMode, GlobalCompositeOperation>>` (per the table, with `linear-dodge → "lighter"`)
  - `isNativeBlend(m: BlendMode | undefined): boolean` (undefined → true)
  - `blendPixel(mode, Cb: [r,g,b], Cs: [r,g,b]): [r,g,b]` (straight colour, 0..1)
  - `compositeInto(dst: Raster, src: Raster, mode: BlendMode, opacity: number, mask?: Float32Array, at?: { x: number; y: number }): void`. Uses the W3C general formula `Co = αs·(1−αb)·Cs + αs·αb·B(Cb,Cs) + (1−αs)·αb·Cb`, `αo = αs + αb·(1−αs)`. `dissolve` uses `hash32(x, y)` against `αs`.
  - `sampleGradient(g: Gradient, box: { w: number; h: number }, w: number, h: number, origin?: { x: number; y: number }, ratio?: number): Raster`. Supports all five styles. Midpoints use the piecewise-linear remap `t<m ? 0.5·t/m : 0.5+0.5·(t−m)/(1−m)` within each stop segment. Opacity stops are interpolated separately. `reverse` flips t. `scale` divides the distance. `angle` follows the Photoshop convention (0° = left→right, 90° = bottom→top).
- [ ] **Step 1: Write the failing tests.**
  - "native modes match canvas" (`@vitest-environment jsdom`): for each of the 15 native modes, with backdrop `#3366cc` and source `#cc9933`, `blendPixel` matches node-canvas `globalCompositeOperation` within 2/255. If node-canvas (Cairo) deviates for a mode, record that mode as a known engine difference in the test and assert against the W3C formula value instead.
  - "linear burn", "vivid light", "pin light", "hard mix", "subtract", "divide", "darker color": the table-driven expected values for 3 colour pairs each.
  - "compositeInto with opacity 0 is a no-op". "mask halves alpha".
  - Gradient: "linear 90° runs bottom to top" (top pixel = last stop, bottom = first). "radial centre equals first stop". "angle style wraps 360°". "reflected is symmetric". "diamond corner equals last stop". "midpoint 0.25 shifts the 50% colour to t=0.25".
- [ ] **Step 2:** Run and expect FAIL. **Step 3:** Implement. **Step 4:** Run and expect PASS.
- [ ] **Step 5:** Commit with `feat(fx): photoshop blend modes and gradient sampler`.

### Task P1.4: `renderEffects` pipeline

**Files:**
- Create: `src/lib/fx/effects.ts`
- Test: `tests/fx/effects.test.ts`

**Interfaces:**
- Consumes: P1.2 and P1.3 outputs, plus `Effects` from P1.1.
- Produces:

```ts
export type FxPart = { raster: Raster; blend: BlendMode; opacity: number };
export type FxRender = { outer: FxPart[]; body: Raster };
export type FxOptions = { ratio: number; fillOpacity: number; box: { x: number; y: number; w: number; h: number } /* element box inside the padded raster, device px */ ; seed: number };
export function renderEffects(content: Raster, fx: Effects | undefined, o: FxOptions): FxRender;
export const SIZE_TO_SIGMA = 0.5;
export function fxPaddingUnits(fx: Effects | undefined): { l: number; t: number; r: number; b: number }; // element units, ratio-free
```

- [ ] **Step 1: Write the failing tests** on a 100×100 raster with a 40×40 opaque white square at (30,30), ratio 1:
  - "no effects returns body equal to content and no outer parts".
  - "fillOpacity 0 keeps an outside stroke fully opaque": a red stroke of size 4 outside, fillOpacity 0. Pixel (28,50) is red with α=1, and pixel (50,50) has α≈0.
  - "drop shadow offset follows angle": angle 90, distance 10, size 0. `outer[0]` alpha at (50,75) is 1, at (50,25) is 0, and the shadow blend defaults pass through.
  - "knockout hides shadow under the layer": the outer part's α at (50,50) is 0 when knockout is true and 1 when false (size 0, distance 0).
  - "inner shadow only inside": alpha outside the square is 0, and the body near the top inner edge (angle 90, distance 4) is darkened.
  - "inner glow center vs edge": the edge glow is brightest at (31,50), and the center glow is brightest at (50,50).
  - "colour overlay replaces colour, keeps alpha shape": overlay `#00ff00`. Pixel (50,50) is green, and α equals the content α at the edges within 2/255.
  - "gradient overlay respects element box, not padded raster": linear 0°, black→white. (30,50) ≈ black and (69,50) ≈ white.
  - "stroke center straddles edge": coverage at d=0 is ≈1 for size 4.
  - "stroke inside never paints outside".
  - "order: stroke above overlay": with both present, an outside-stroke pixel shows the stroke colour, and an inside-stroke pixel shows the stroke over the overlay.
  - "precise glow reaches exactly size px".
  - "disabled effects are skipped".
- [ ] **Step 2:** Run and expect FAIL. **Step 3:** Implement exactly the order and geometry in "Rendering design". Use one distance field per render, computed lazily. **Step 4:** Run and expect PASS.
- [ ] **Step 5:** Commit with `feat(fx): layer effects pipeline`.

### Task P1.5: Fx Konva shape, cache, readback and `render.ts` integration

**Files:**
- Create: `src/lib/fx/cache.ts`, `src/lib/fx/readback.ts`, `src/lib/fx/fxShape.ts`
- Modify: `src/lib/render.ts` (`elementNodes(el, image, opts?)` delegates to `fxShapeAttrs` when `needsFx`; rename today's body to `baseNodes`; `groupAttrs` adds `globalCompositeOperation` and folds `fillOpacity` into opacity on the non-fx path; `renderElementsCanvas` and `renderElementLayer` use `visualBounds` instead of `getClientRect({ skipShadow: true })` for the box; `renderElementLayer` gets `opts?: { effects?: boolean }`, defaulting to true; P6 passes false)
- Modify: `src/store/view.ts` (add `transforming: boolean`)
- Test: `tests/fx/cache.test.ts`, `tests/render/fx-shape.test.ts` (jsdom)

**Interfaces:**
- Produces:
  - `needsFx(el: Element): boolean`
  - `fxShapeAttrs(el: Element, image: Bitmap | null | undefined, opts: { fontsVersion?: number; part?: "all" | "outer" | "body" }): Record<string, unknown>`. Konva Shape attrs: `width`, `height`, `sceneFunc` and `hitFunc`. `part` is used by clip stacks in P4.
  - `fxPadding(el: Element): { l; t; r; b }` (element units, including the base stroke pad)
  - `visualBounds(el: Element): { x; y; width; height }` (page units, rotation applied)
  - `fxRatio(scale: number, w: number, h: number): number`
  - `class FxCache { get(key); set(key, id, value); getStale(id); clear() }` and `export const fxCache = new FxCache(64, 256_000_000)`
  - `fxKey(el: Element, ratio: number, fontsVersion: number): string`
  - `readBackdrop(ctx: CanvasRenderingContext2D, rect: DOMRectLike): ImageData | null` (returns null for an empty rect)
  - `writeBackBlended(ctx: CanvasRenderingContext2D, rect: DOMRectLike, coverage: Float32Array, colorPremul: Float32Array): void`
  - `elementNodes(el: Element, image?: Bitmap | null, opts?: { fontsVersion?: number }): NodeSpec[]`. Existing callers keep compiling because `opts` is optional.

- [ ] **Step 1: Write the failing tests.**
  - `cache.test.ts`: "key ignores x/y/rotation/opacity". "key changes with width and with effects". "LRU evicts oldest past capacity". "pixel budget evicts". "getStale returns last by id".
  - `fx-shape.test.ts` (`@vitest-environment jsdom`, build via the exported `renderPageCanvas` with a mocked `loadAssetImage` and `ensureFonts`):
    - "element without fx uses plain nodes": `elementNodes(rectEl())[0].kind === "Rect"`.
    - "drop shadow appears in page render": a 200×200 page, a white background, a black 40×40 rect at (80,80) with a red drop shadow (angle 90, distance 20, size 0, multiply off/normal). Pixel (100,130) is red within tolerance 10.
    - "multiply shadow multiplies backdrop": with a `#00ff00` background and a `#ff0000` multiply shadow at 100% opacity, the shadow pixel ≈ black.
    - "non-native blend linear-burn on element draws via readback": a `#808080` rect with linear-burn over a `#c0c0c0` page gives ≈ `#404040` (±3).
    - "zero-size element renders nothing and does not throw": width 0.1, height 0 text with effects.
    - "renderElementLayer box includes shadow": a box with a size-10, distance-20 shadow is ≥ 20 px taller than the element.
    - "renderElementLayer with effects:false excludes shadow and does not apply fillOpacity".
    - "fxRatio caps total pixels": `fxRatio(8, 4000, 4000)²·4000² ≤ 16e6`.
- [ ] **Step 2:** Run and expect FAIL.
- [ ] **Step 3: Implement `fxShapeAttrs.sceneFunc`.** Get the ratio. Look up the cache, or on a miss rasterize the content (detached Konva group from `baseNodes`; `Konva` is passed in via a dynamic-import-free module-level reference, because `render.ts` already imports the type and `ElementNode` imports react-konva, which loads Konva). Run `renderEffects`, convert the parts to canvases and store them. Draw the outer parts with `ctx.globalCompositeOperation = NATIVE_BLEND[part.blend] ?? software path` and `ctx.globalAlpha *= part.opacity`. Draw the body with the element blend (native, or readback when non-native). `hitFunc` is as specified in the design.
- [ ] **Step 4:** Run and expect PASS. Then run `npm run build`; the static export must compile.
- [ ] **Step 5:** Commit with `feat(render): draw layer effects and blend modes in editor and exports`.

### Task P1.6: Editor wiring (ElementNode, Canvas, Rasterize)

**Files:**
- Modify: `src/components/editor/ElementNode.tsx` (pass `{ fontsVersion }` into `elementNodes`; key the Shape by `fontsVersion` as Text is today)
- Modify: `src/components/editor/Canvas.tsx:345,379` (stop using `findOne("Text")`; text width = `el.width * sx`, since the Text node may now be inside an fx shape; set `useView.transforming` true/false in the transform start/end handlers)
- Modify: `src/components/editor/actions.ts` (`rasterizeElements`: the produced image keeps `blendMode`; effects are baked, so clear `effects`, `fillOpacity` and `blendMode`. Single-element rasterize places the image at `visualBounds`)
- Test: `tests/render/editor-fx.test.ts` (jsdom; pure helpers only) plus a manual check

- [ ] **Step 1: Write the failing test.** "rasterize keeps shadow inside box": call `renderElementsCanvas([elWithShadow])` and expect `box.height ≥ el.height + shadow.distance`.
- [ ] **Step 2:** Implement and run `npm test`.
- [ ] **Step 3: Manual verification.** Use the `run` skill to start `npm run dev` and open `/app`. In the devtools console, set a drop shadow on a rect via `useEditor.getState().update([id], { effects: {...} })`. Check:
  (a) the shadow draws;
  (b) the selection box hugs the rect and not the shadow;
  (c) dragging is smooth with no re-render per frame (verify with the Performance panel or a temporary counter);
  (d) resizing shows the stretched stale render and then a sharp one;
  (e) zooming re-renders sharp;
  (f) PNG, PDF and PSD export include the shadow.
- [ ] **Step 4:** Commit with `feat(editor): effects render live on canvas`.

### P1 notes (implemented 2026-10-25; these win over the P1 text above)

- **Files.** `Color` moved to `src/lib/color.ts` (imported by `model.ts` and `effects.ts`). Shape outline helpers (`polygonPoints`, `roundedRect`, `traceShape`) moved to `src/lib/shapes.ts`, and `render.ts` re-exports them, so `fxShape.ts` imports no runtime code from `render.ts` (it imports only types from it). `Design` gains `version?: number`.
- **`fxShapeAttrs(el, image, opts)`** takes `opts.nodes` (the `baseNodes(el, image)` specs) from `elementNodes`, because of that one-way import. Konva reaches the fx module through `provideKonva(Konva)`: `render.ts buildElement` calls it after its dynamic import, and `ElementNode.tsx` calls it at module load. `fxShape.ts` reads `useView.getState().transforming` (the ids being resized) directly. `opts.live` (passed only by `ElementNode`) marks editor rendering; see "Editor vs export rendering" below.
- **Interior effects are composited in shape-relative space.** We don't mask each interior effect by `A`. Instead the body starts as content ÷ A × fillOpacity, the overlays, inner glow and inner shadows are composited onto it at full coverage, and the result is multiplied by `A` once. This gives exactly "replace colour, keep alpha" at soft edges and still shows overlays at fill 0. Strokes go on afterwards, unmasked. `compositeInto` still accepts `mask` (dst-indexed) and gained an optional 7th `seed` argument for dissolve.
- **Distance field sign convention.** A solid pixel is at `-(√insideSq − 0.5)` and an empty one at `+(√outsideSq − 0.5)`. A partly covered pixel is at `0.5 − A`, which replaces the "+(0.5 − A)" correction. Inner shadows and inner glows blur the *eroded shape* and invert it (`1 − blur(core)`), instead of blurring `1 − A`. That way, zero padding at the raster edge can't lighten them.
- **Padding.** Blur reach is `4σ = 2·size` (not 1.5·size), plus 1 px; the three-box blur's support is about 3.5σ, so the tail is inside the box. The base pad of 2 px, or `max(2, 1.5·strokeWidth)`, or `max(2, 0.2·fontSize)` for text (italic overhang, descenders), is added to the effect pad.
- **8-bit rounding (the "hard edge at the pad boundary" bug).** The band of 254 ending in a step to 255 was not a cut-off tail: the box blur's float running sums leave residue around 1e-8 everywhere, and `toPixels` wrote alpha as `a·255 + 0.5` into a `Uint8ClampedArray`, which already rounds to nearest, so every residue became alpha 1. `toPixels` and `writeBackBlended` no longer add 0.5, and alpha under half a level is written as 0. A test asserts the exported layer's edge alpha is 0.
- **Bounds and exact boxes.** `renderElementsCanvas` and `renderElementLayer` use `visualBounds` only when `needsFx(el)`. Plain elements keep `getClientRect`, so their raster and PSD layer boxes are unchanged (an image on whole pixels keeps its exact size). `renderElementLayer(..., { effects: false })` strips `effects`, `blendMode` and `fillOpacity`.
- **Plain path.** `groupAttrs` always sets `globalCompositeOperation` ("source-over" unless there is a native blend) and multiplies `fillOpacity` into opacity, but only when `!needsFx`. `needsFx` does not fire for `fillOpacity` alone or for native blends.
- **Gradients.** A stop's `midpoint` applies to the segment *ending* at that stop, so the first stop's midpoint is unused. Radial radius = half the box diagonal. Linear, reflected and diamond use the box's extent along the angle. Angle style goes counter-clockwise from the angle. `alignWithLayer: false` is treated as true for now. All of this is to be checked against Photoshop in P3.6.
- **Rotation.** Effects render in the element's own frame (rotation is not in the cache key), so a rotated element's shadow angle and gradient overlay rotate with it. Imported PSD layers have no rotation, so this only affects elements the user rotates.
- **Cache key** also includes whether the image has loaded (its natural width) and, for text, `document.fonts.check()`. That way a placeholder or fallback-font render is never reused, including by exports, which pass `fontsVersion` 0. When the effects use dissolve anywhere, the key also holds the id-derived seed, so twins don't share noise. `get(key, id)` makes a hit the element's last render for `getStale`.
- **Cache memory.** Budget 48M device px (`FX_CACHE_BUDGET`, about 190 MB RGBA), 64 entries; evicted, replaced and cleared entries have their canvases set to 0×0 (`releaseEntry`), since a canvas's memory otherwise waits for GC. The Konva `toCanvas` of the plain nodes is released right after it's read. fx renders cap at 6M px (`MAX_PIXELS`, was 16M): the pipeline peaks around 50 bytes/px. `renderEffects` builds the body in the content's own buffer (the content raster is consumed) and hands each outer part to a `keep` callback as soon as it is made, which turns it into a canvas, so only one part's float buffer is alive at a time. Readback blends reuse pooled scratch canvases (`mask`, `color`, `tmp`, `group`); one over 1M px gives its memory back after use.
- **Body and outer resolutions.** `ratios()` caps the body's ratio on the box plus base and stroke padding only; the outer parts get their own (lower or equal) ratio capped on the full padded box. When they differ, the content is rasterized twice (`parts: "outer"` at the outer ratio, `parts: "body"` at the body ratio) and `FxEntry` holds `outerPad`/`outerRatio` beside the body's `pad`/`ratio`. A far shadow no longer blurs the element.
- **Editor vs export rendering.** Exports and thumbnails (`live` unset) render synchronously at the exact scale. The editor quantizes to √2 steps, and once an element has a cached render it keeps drawing that (stretched; for text, scaled by font size only, so a re-wrap never stretches glyphs) while the new one renders in a timer (80 ms, throttled per element) that ends with `layer.batchDraw()`. Elements whose ids are in `useView.transforming` stretch the stale render with no re-render until the transform ends.
- **Layer blend mode applies to the whole layer (#14).** When the element's blend mode isn't normal and it has outer parts, `drawGroupBlended` (readback.ts) reads the backdrop once, composites each outer part onto it with its own mode (so a multiply shadow multiplies the layers below, and later parts blend over earlier ones), derives the group that over the backdrop gives that result (`G = cur − B·(1 − αG)`, premultiplied), lays the body over it normally, and draws the group with the layer's mode (native op, or `drawBlended`). With mode normal this equals the old per-part drawing, which is kept for speed. So a black shadow on a Screen layer vanishes, as in Photoshop where the layer's mode governs its effects. Interior effects keep blending against the content in shape-relative space (as Photoshop's "Blend Interior Effects as Group"). To be checked against Photoshop in P3.6. Costs one `getImageData` per draw for such layers.
- **Rasterize** renders a single element with its `blendMode` stripped and gives the new image that `blendMode`. Effects and fill opacity are baked in (a single plain element's fill opacity too: the group opacity it is drawn with is `fillOpacity`, not 1). `canRasterize` is now true for an image with active effects or fill opacity < 1. `EraseEditor` uses `baseNodes`.
- **Canvas.** `onTransformStart` sets `useView.transforming` to the transformed node ids (leaving out text being re-wrapped at a side anchor); `onTransformEnd`, a selection change, Escape and unmount clear it. Text with effects re-wraps live at side anchors like plain text: `onTransform` writes its width to the store (coalesced, one undo step with the transform end) and resets the node scale. `ElementNode` remounts a `Shape` on `fontsVersion` only for text elements.
- **Version stamp.** `newDesign` stamps `version: FORMAT_VERSION`; `migrateDesign` stamps it on older designs.
- **Engine check.** node-canvas (Cairo) matched our W3C formulas within 2/255 for all 15 native modes on the test pair.
- **Not done in P1.** A manual browser check (P1.6 step 3), replaced by headless `renderPageCanvas` tests (`tests/render/fx-shape.test.ts` "every P1 effect"). Outer parts with a non-native blend use the same readback path as the body.

**P1 risks:** Cairo's blend modes vs Chrome's may differ by a few levels (tests carry tolerances; the browser is the reference). Readback blends on large elements cost a `getImageData` per draw; they are cached per frame only by the layer redraw, which is acceptable because the non-native modes are rare. Konva `toCanvas` of a detached node must not attach to a Stage; verify that fonts are loaded (`ensureFonts`) before the first fx text render, or the cache keeps a fallback-font raster (`fontsVersion` in the key fixes that on the next bump).

---

# Phase 2: Effects editor UI

**Goal:** Users can add, edit, reorder, toggle and remove every supported effect, set blend mode and fill opacity, apply presets, and do all of this on a multi-selection with clean undo.

### Task P2.1: Effect editing helpers (pure)

**Files:**
- Create: `src/lib/effectEdit.ts`
- Test: `tests/model/effect-edit.test.ts`

**Interfaces:**
- Produces:
  - `type FxKind = "dropShadow" | "innerShadow" | "outerGlow" | "innerGlow" | "stroke" | "colorOverlay" | "gradientOverlay"`
  - `defaultEffect(kind: FxKind, el: Element): <the effect>`. Defaults: shadow black, opacity 0.35, angle 120, distance `max(4, 0.03·min(w,h))`, size `2×distance`. Stroke 4 px outside in `#000000`. Glow `#ffd54a` with size 12. Colour overlay `#3e3aa8`. Gradient overlay from `#3e3aa8` to `#0e1530` at 90°.
  - `addEffect(fx: Effects | undefined, kind, value): Effects`, `removeEffect(fx, kind, index?)`, `moveEffect(fx, kind, from, to)`, `patchEffect(fx, kind, index, patch)`, `toggleEffect(fx, kind, index)`
  - `PRESETS: { id: string; label: string; effects: Effects; blendMode?: BlendMode; fillOpacity?: number }[]` with ids `soft-shadow`, `long-shadow`, `outline`, `neon`, `emboss-lite` (inner shadow + inner glow), `duotone` (gradient overlay with color blend) and `ghost` (fillOpacity 0 + outside stroke). Write the values fresh; don't copy them from another product.
  - `commonValue<T>(els: Element[], get: (e: Element) => T): T | "mixed"`
- [ ] **Step 1: Write the failing tests.** "add then remove leaves effects empty → undefined" (the whole `effects` key is removed when it's empty, so `needsFx` turns false). "moveEffect reorders shadows". "patchEffect on multi-shadow edits only index". "commonValue mixed".
- [ ] **Steps 2–4:** FAIL, then implement, then PASS. **Step 5:** Commit with `feat(editor): effect editing helpers and presets`.

### Task P2.2: Effects popover in ContextToolbar

**Files:**
- Create: `src/components/editor/EffectsPanel.tsx`
- Modify: `src/components/editor/ContextToolbar.tsx` (an "Effects" `Popover` next to Transparency for every element type; the Transparency popover gains a "Fill" slider for `fillOpacity` and a blend-mode `<select>`)
- Modify: `src/components/ui.tsx` (add `Select` and `GradientInput` primitives: a stop bar with add/remove/drag of stops using the existing `ColorInput`; `Toggle`)
- Test: `tests/store/effects-undo.test.ts` (jsdom)

**Interfaces:**
- Consumes: `effectEdit.ts`, `useEditor.update(ids, fn, { coalesce })`.
- Produces: `<EffectsPanel ids={string[]} />`, which reads elements from the store. Every slider calls `st.update(ids, (e) => ({ effects: patchEffect(e.effects, kind, i, patch) }), { coalesce: \`fx:${kind}:${i}:${field}:${ids.join()}\` })`. The patch applies per element, so a multi-selection keeps each element's other effects. When the selection is mixed, a section shows "Mixed" and the first edit writes the edited value to all elements.
- UI layout (decided): a list of the seven effect kinds, each row with an enable checkbox, a name and a "+" for the array kinds. Expanding a row shows its fields. A presets strip sits at the top; "Clear all" is at the bottom. Blend mode names come from `BLEND_MODE_LABELS` in `effects.ts` (Title Case, grouped like Photoshop: Normal / Darken / Lighten / Contrast / Inversion / Component). `pass-through` is hidden for non-groups.
- [ ] **Step 1: Write the failing test.** "effect slider coalesces into one history entry": load a design, select 2 rects, call the same `update` with the same coalesce key 10 times within 600 ms (fake timers), and expect `past.length === 1` with both rects updated.
- [ ] **Step 2:** Run and expect PASS (this is store behaviour; it documents the contract). If it fails, fix the store and not the test.
- [ ] **Step 3:** Build the UI. Popovers must fit at phone width; the existing `Popover` already positions itself. Panels scroll at `max-h-[70vh]`.
- [ ] **Step 4: Manual check** with the `run` skill. Apply each preset to text, a shape, an image, a line and a path; undo and redo; check multi-select with mixed effects; set fill 0% on text with a stroke (outline text); try every blend mode over a photo.
- [ ] **Step 5:** Commit with `feat(editor): effects panel, blend modes and fill opacity`.

**P2 risks:** Toolbar width on mobile (put Effects inside the "more" overflow if the bar overflows). Gradient stop editor complexity: keep it to click-to-add and drag, with no midpoint diamonds in the UI. Midpoints import and render, but the UI doesn't edit them.

### P2 notes (implemented 2026-10-25; these win over the P2 text above)

- **Files.** Helpers in `src/lib/effectEdit.ts` (tests `tests/effects-ui/effect-edit.test.ts`, 22 cases). `BLEND_MODE_LABELS`/`BLEND_MODE_GROUPS` live there, not in `effects.ts`, to stay out of P3's lane. UI in `src/components/editor/EffectsPanel.tsx`; `Select`, `Toggle`, `GradientInput` and a `mixed` prop on `Slider` in `src/components/ui.tsx`. The undo contract test is `tests/effects-ui/effects-undo.test.ts` (passed first run: store behaviour, no store change needed).
- **Helper API additions.** `effectList(fx, kind)` (singletons as a 0/1 list), `FX_KINDS`, `MAX_PER_KIND`, `applyPreset(p)` (returns `effects`, `blendMode`, `fillOpacity`, so a preset resets the latter two), `hasEffects(el)` (toolbar highlight), and gradient stop helpers `colorAt`, `addStop`, `removeStop`, `moveStop`. `patchEffect` takes an optional 5th `fallback`: an element lacking the effect gets `fallback + patch`, which is how a mixed multi-selection's first edit gives every element the effect.
- **Defaults/presets.** Drop and inner shadow default to `multiply` (all shadow presets too). Glows default to `normal`, not `screen`: a screen glow is invisible on the default white page. Defaults are full schema objects (no reliance on zod defaults).
- **Multi-select.** A kind's reference list is the first selected element that has that kind; rows and fields show "Mixed" when elements differ. Instances beyond the reference's count (e.g. an image's 2nd shadow while the shape has 1) are not editable until the selection narrows.
- **Toolbar.** Effects popover (Sparkles icon, accent when the selection has effects/blend/fill) sits before the Transparency popover, which is now "Transparency and blending" with Transparency, Fill (100% writes `undefined`) and a grouped Blend mode select (`normal` writes `undefined`). Panel is `w-72`, `max-h-[70vh]` scroll; fits a 390 px phone.
- **Gradient stop editor.** Click the bar to add (colour sampled at that point), drag or arrow-key a handle (Shift = 10%), Delete/Remove (min 2 stops). No midpoint or opacity-stop editing (kept on the data).
- **Review fixes (2026-10-25).** `patchEffect` adds the fallback only when `index === list.length` (a multi-select drag no longer adds one effect per event; shorter lists are left alone) and also takes a function of the element's own effect. Gradient and stroke-paint edits go through `patchGradient` / per-element paint patches, so each element keeps its other gradient settings. Instances are keyed by `useInstanceKeys` in the panel (ids that follow the panel's own move/remove; object identity can't be used because every edit structuredClones the design). Move/remove are disabled while the selection's lists of that kind differ (`sameEffectList`). `commonValue` compares by reference before serialising. Sliders widen to fit imported values past their range. Empty kinds show an explicit + Add button (no silent add from the label or toggle); `aria-controls` is set only while the panel exists. Gradient editor: "Add" button (middle of the widest gap, `stopToAdd`), focus follows a keyboard-moved stop, arrow/Delete keys stop propagation. Editor shortcuts skip events that are `defaultPrevented`, inside `[role=dialog]`/`[data-popover]` (Popover panels now carry both), any key on sliders/options, and Space/Enter on buttons/switches (`skipsShortcuts` in `ui.tsx`; Delete on a focused toolbar button still deletes the selection).
- **Browser check (dev, Chrome).** Every effect added via the UI on text, a star shape and an uploaded image; text stroke inside/center/outside; 12-event slider drag = one undo; multi-select edit of mixed shadows kept each element's other effects and undid in one step; reorder, toggles, presets (Ghost gives outline text), Fill + Multiply on an image. No console errors; one Chrome warning "getImageData … willReadFrequently" from the P1 readback path (non-native/whole-layer blends), worth a look in P1 follow-up.

---

# Phase 3: PSD import fidelity (effects, blend modes, fill opacity, baking, notes)

**Goal:** PSD layer effects arrive as editable effects. Blend modes and fill opacity are kept. Unsupported effects are baked into the layer pixels. A persistent import report lists what was simplified, per layer.

### ag-psd → model mapping (`src/lib/importers/psdEffects.ts`)

| ag-psd | Model | Notes |
|---|---|---|
| `Layer.blendMode` | `blendMode` | `"linear dodge"→"linear-dodge"` etc. via `PSD_TO_BLEND`. `"pass through"` on non-groups → normal. `"linear height"`/`"height"` → normal plus a note. `"subtraction"` → `subtract` |
| `Layer.opacity` | `opacity` | no longer multiplied by fillOpacity |
| `Layer.fillOpacity` | `fillOpacity` | omitted when it's 1 |
| `effects.disabled` | every effect `enabled:false` | |
| `effects.scale` | multiplies all sizes and distances | |
| `UnitsValue` | px | `Pixels`: value. `Points`: value × dpi/72 (dpi from `imageResources.resolutionInfo.horizontalResolution`, default 72). Other units: value. Then × the design `scale` from `fitDesignSize` |
| `dropShadow[]` (LayerEffectShadow) | `Shadow[]` | `size`, `distance`, `angle` (`useGlobalLight` → `imageResources.globalAngle ?? 120`), `color` via `colorHex`, `opacity`, `blendMode`, `choke.value/100 → spread`, `layerConceals → knockout`, `contour.curve` (0..255 → 0..1) → contour when non-linear |
| `innerShadow[]` | `InnerShadow[]` | `choke.value/100 → choke` |
| `outerGlow` | `Glow` | `choke.value/100 → spread`; `noise>0`, `jitter>0` or `range≠50` → note "simplified" (not baked; visual difference is small) |
| `innerGlow` | `InnerGlow` | `source`, `technique`, `choke.value/100 → choke` |
| `stroke[]` | `StrokeFx[]` | `fillType: color → Paint color`, `gradient` (solid) → Paint gradient (`stroke.gradient.scale` as-is, already a fraction). `pattern` and noise gradients → **bake** |
| `solidFill[]` | `ColorOverlay[]` | |
| `gradientOverlay[]` | `GradientOverlay[]` | solid gradients: colorStops (`location` as-is, already 0..1; `AG_PSD_LOCATION_SCALE = 1`), `midpoint` as-is (already 0..1), opacityStops (`opacity` 0..1), `type→style`, `angle`, `scale` as-is (fraction), `reverse`, `align`, `offset.{x,y}` as-is (fractions). Noise gradients → **bake** |
| `bevel`, `satin`, `patternOverlay` | none | **bake** |

The location scale and percent units are confirmed in "P0 findings" (location 0..1, percents already fractions). Write the scale as the named constant `AG_PSD_LOCATION_SCALE = 1` with a comment pointing to those findings. All effect opacities are 0..1 as-is.

### Baking (decided)

ag-psd doesn't render effects, so baking uses our own approximations in `src/lib/fx/bake.ts`, run in the worker on the layer's pixels (the worker has `OffscreenCanvas`, and the pipeline is pure Float32):
- **Bevel & emboss** (inner bevel, outer bevel, emboss, pillow emboss; smooth and chisel techniques): height = `smoothstep` of the distance field clamped to `size`. Smooth technique blurs it with σ=`soften`, chisel uses the raw distance. Surface normal comes from the height gradient. Lambert shading against a light at `angle`/`altitude` gives highlight (screen-like, `highlightColor`/`highlightOpacity`/`highlightBlendMode`) and shadow (`shadowColor`/…) layers composited with `compositeInto`. Outer bevel shades the band outside the shape; emboss does both sides; pillow inverts the outer band. `direction: "down"` flips the light. `stroke emboss` is applied to the stroke region. Texture: ignored, with a note.
- **Satin:** two copies of `A` offset by ±(angle, distance), blurred by size, `|a−b|`, optionally inverted, masked by `A`, coloured, and composited with its blend.
- **Pattern overlay and pattern stroke:** look up `psd.patterns` by `pattern.id` (needs `skipLinkedFilesData` to stay and patterns to load; patterns are in `Psd.patterns`/`globalLayerMaskInfo`, so verify the location in the fixture). Tile at `scale` (already a fraction) with `phase`, masked by `A`. A missing pattern falls back to 50% grey plus a note.
- **Noise gradients:** sample the seeded noise model approximately as a stepped random-colour ramp from `min`/`max` per channel. Always noted as approximate.

Bake order inside the body follows Photoshop's stack. Baked effects are part of the pixels, so baked interior effects must not be faded by `fillOpacity`. When anything interior is baked, the layer's content is pre-multiplied by `fillOpacity` before baking and `fillOpacity` is reset to 1. **Supported** interior effects that sit **below** a baked one in Photoshop's order (overlays under bevel) are baked too, so the order stays correct, and the note lists them. Supported effects above it stay editable. The baked bitmap grows by the bake padding (the outer bevel extends the box), and the element's x/y/width/height grow to match.

### Task P3.1: Extract a pure `convert()` and add a richer `PsdNode`

**Files:**
- Create: `src/lib/importers/psdConvert.ts` (move `convert`, `readText`, `toRgba8`, `applyMask`, `colorHex`, `isBlank`, `hasEffects` from the worker; `png` is injected)
- Modify: `src/lib/importers/psd.worker.ts` (thin wrapper: `initializeCanvas`, `readPsd`, calls `convert(psd, report, { encode: png })`)
- Test: `tests/import/convert.test.ts`

**Interfaces:**
- Produces: `convert(psd: Psd, report: (done: number, total: number) => void, io: { encode: (rgba: Uint8ClampedArray, w: number, h: number) => Promise<Blob> }): Promise<PsdResult>`. Tests pass `encode: async (rgba, w, h) => new Blob([rgba])`.
- `PsdNode` gains `blendMode?: BlendMode`, `fillOpacity?: number`, `effects?: Effects`, `issues?: ImportIssue[]` (see P3.3) and `pad?: { l; t; r; b }`. In this task, `convert` still behaves exactly as today (a pure refactor).
- [ ] **Step 1: Write the characterization tests.** "flat pixel layers come through with positions". "group opacity multiplies into child" (current behaviour, changed in P4). "hidden layer stays hidden". "text layer yields text node". Fixtures come from `buildPsd` + `readFixture`.
- [ ] **Steps 2–4:** Write the tests against the existing behaviour → move the code → PASS. **Step 5:** Commit with `refactor(import): pure psd convert for testing`.

### Task P3.2: Map effects, blend mode and fill opacity

**Files:**
- Create: `src/lib/importers/psdEffects.ts`
- Modify: `src/lib/importers/psdConvert.ts` (use the mapping; stop multiplying fillOpacity into opacity; drop the "Blend modes show as Normal" and "Layer effects were left out" notes for supported features)
- Modify: `src/lib/importers/psd.ts` (copy `blendMode`, `fillOpacity` and `effects` scaled by `scale` onto elements; `scaleEffects(fx, s)` lives in `effectEdit.ts`)
- Test: `tests/import/psd-effects.test.ts`

**Interfaces:**
- Produces:
  - `PSD_TO_BLEND: Record<PsdBlendMode, BlendMode>`, `BLEND_TO_PSD: Record<BlendMode, PsdBlendMode>`
  - `psdEffectsToModel(fx: LayerEffectsInfo | undefined, ctx: { dpi: number; globalAngle: number }): { effects?: Effects; unsupported: UnsupportedFx[] }`, with `UnsupportedFx = "bevel" | "satin" | "patternOverlay" | "patternStroke" | "noiseGradient" | "glowNoise"`
  - `modelEffectsToPsd(fx: Effects | undefined): LayerEffectsInfo | undefined` (written now, exercised in P6a). Always writes `enabled` explicitly on every effect (`enabled: true` for active ones), because ag-psd reads a missing `enabled` as false.
  - `psdGradientToModel(g, extra): Gradient | null` and `modelGradientToPsd(g: Gradient): EffectSolidGradient & ExtraGradientInfo`
  - `unitsToPx(u: UnitsValue | undefined, dpi: number): number`
- [ ] **Step 1: Write the failing tests** (build `LayerEffectsInfo` objects directly, and use one binary round trip per kind through `buildPsd`):
  - "drop shadow maps with global light": `useGlobalLight: true` with `imageResources.globalAngle = 30` gives angle 30.
  - "choke percent to spread": 25 → 0.25.
  - "points convert at 144 dpi": size 10 pt → 20 px.
  - "solidFill maps to colorOverlay array".
  - "stroke gradient maps; pattern stroke reported unsupported".
  - "disabled fx imports as enabled:false".
  - "gradient locations normalized 0..1" (ag-psd `location`/`midpoint` taken as-is, not divided again).
  - "gradient scale and offset are fractions": `scale: 1.5` → 1.5, `offset.x: 0.2` → 0.2.
  - "export writes enabled true": `modelEffectsToPsd` output has `enabled: true` on every active effect.
  - "round trip model→psd→model is identity for every supported kind" (deep-equal with 1e-3 tolerance).
  - "fillOpacity kept separate": a layer with opacity 0.5 and fillOpacity 0.4 gives an element with `opacity 0.5` and `fillOpacity 0.4`.
  - "blend mode kept": multiply → `multiply`, `pass through` on a pixel layer → undefined.
- [ ] **Steps 2–4:** FAIL, implement, PASS. **Step 5:** Commit with `feat(import): psd layer effects, blend modes and fill opacity stay editable`.

### Task P3.3: Bake unsupported effects

**Files:**
- Create: `src/lib/fx/bake.ts`
- Modify: `src/lib/importers/psdConvert.ts` (when `unsupported.length`, bake into the pixel buffer, enlarge the node box, strip the baked effects plus any supported effects below them, and record issues)
- Test: `tests/fx/bake.test.ts`, `tests/import/psd-bake.test.ts`

**Interfaces:**
- Produces:
  - `bakeEffects(content: Raster, fx: LayerEffectsInfo, o: { dpi: number; globalAngle: number; fillOpacity: number; patterns?: PatternInfo[]; seed: number }): { raster: Raster; pad: { l; t; r; b }; baked: string[]; keep: Effects | undefined }`. `keep` is the subset that stays editable.
  - `type ImportIssue = { kind: "baked" | "approximated" | "dropped" | "info"; message: string }`
- [ ] **Step 1: Write the failing tests.**
  - "inner bevel lightens the lit edge": a square, angle 90 (light from the top). The top inner band's mean luminance is above the bottom band's.
  - "outer bevel grows the box": `pad.l > 0`.
  - "satin changes interior only": α outside equals the original.
  - "pattern overlay tiles": 2×2 checker pattern data. Pixel parity matches within the layer.
  - "bake folds fillOpacity": fillOpacity 0.5 with a bevel gives a result whose untouched interior α is ≈ 0.5, and the node's `fillOpacity` is undefined.
  - "supported effects above a bake stay editable": bevel + stroke + colour overlay. `keep.stroke` is defined, `keep.colorOverlay` is undefined (it's below the bevel), and `baked` includes "Colour overlay".
  - "issues list names the layer": `node.issues[0].message` contains "Bevel".
- [ ] **Steps 2–4:** FAIL, implement, PASS. Keep the bevel code to ≤ 200 lines. It's an approximation; fidelity tuning happens in P3.6.
- [ ] **Step 5:** Commit with `feat(import): bake bevel, satin and pattern effects into layer pixels`.

### Task P3.4: Persistent import report and notes UI

**Files:**
- Modify: `src/lib/model.ts` (`Design.importReport` is optional: `{ source: z.enum(["psd","pdf"]), fileName: z.string().max(200), at: z.number(), notes: z.array(z.string().max(500)).max(50), items: z.array(z.object({ elementId: z.string().optional(), layerName: z.string().max(120), kind: z.enum(["baked","approximated","dropped","info"]), message: z.string().max(500) })).max(2000) }`)
- Modify: `src/lib/importers/psd.ts` (fill `design.importReport`; the ephemeral `ImportReport` toast stays, but its notes become a short summary such as "3 layers had effects baked into pixels. See Import notes.")
- Modify: `src/lib/importers/job.ts` (`ImportReport` gains an optional `itemsCount`)
- Create: `src/components/editor/ImportNotes.tsx` (a list grouped by kind; clicking an item selects the element; "Dismiss all" clears `importReport` via `mutate`)
- Modify: `src/components/editor/SidePanel.tsx` (LayersTab: an info badge on rows whose id is in `importReport.items`; a footer button "Import notes (n)" opens the panel)
- Modify: `src/components/ImportStatus.tsx` (the toast gets a "View details" button that opens the notes)
- Test: `tests/import/report.test.ts`

- [ ] **Step 1: Write the failing test.** "importPsd writes importReport with element ids": mock `storage`, `renderThumbnail` and `fontMatch.availableFamilies`, and stub `parse` (the worker) by injecting `convert` output. Every `items[].elementId` exists in `page.elements`.
  To make this testable, refactor `importPsd` into `importPsd(file, onProgress)` → `buildDesignFromPsdResult(result, fileName, deps)`, which is pure apart from `saveAsset`, passed in `deps`.
- [ ] **Steps 2–4:** FAIL, implement, PASS. **Step 5:** Manual check with the `run` skill: import a PSD built in a test as a downloadable file (add a dev-only script `scripts/make-fixture-psd.mjs` that writes `out-fixtures/effects.psd`, gitignored), then check the badge, the panel and select-on-click.
- [ ] **Step 6:** Commit with `feat(import): per-layer import notes`.

### Task P3.5: Lossy composite policy

**Files:** Modify `src/lib/importers/psdConvert.ts` and `psd.ts`.
- Decided: `lossy` is now true only when something visible was **dropped** or **approximated** (adjustments before P5, smart object warps, noise, unknown blend). Baking alone doesn't set it, since a bake is a faithful approximation. When `lossy` is true, the hidden locked composite layer stays as today.
- [ ] Test "bake-only file has no composite layer". Then implement and commit with `feat(import): keep reference composite only when something was dropped`.

### Task P3.6: Visual calibration pass

**Files:** `src/lib/fx/effects.ts` (constants only, with the measured error figures recorded in a comment next to each constant).
- [ ] Generated fixtures only (no real PSD samples available). Build PSDs with `buildPsd` covering shadows, glows, strokes and bevels, plus gradients at smoothness 100% and below (`Intr` < 4096), and check our renders and mappings against hand-computed expectations. Tune `SIZE_TO_SIGMA`, the glow falloff and the bevel altitude response visually from these renders, and record the chosen values and reasoning in the constants' comments. Commit with `chore(fx): calibrate effect constants against generated fixtures`.
- [ ] **Deferred: needs real Photoshop file.** Comparing our render against a Photoshop composite (target: mean absolute error per channel < 8/255 on shadow regions) and the real-file `Lctn`/`Intr` check from "P0 findings". Not blocking; pick it up when the user supplies files (don't download third-party files).

**P3 risks:** Gradient `location` on real files with smoothness under 100% (deferred: needs real Photoshop file). Pattern data location. Bake runtime on 1000-layer files: bake only layers that have unsupported effects, report progress per layer, and cap the bake raster with the same 16 M px rule (above it, scale down and note).

### P3 notes (implemented 2026-10-25; these win over the P3 text above)

- **Files.** `src/lib/importers/psdConvert.ts` (pure `convert(psd, report, { encode })`; the worker is a thin wrapper and re-exports the types), `src/lib/importers/psdEffects.ts` (mapping both ways, `PSD_TO_BLEND`/`BLEND_TO_PSD`, `mapBlendMode`, `unitsToPx`, `colorHex`, `AG_PSD_LOCATION_SCALE = 1`, and `scaleEffects`, which lives here rather than in `effectEdit.ts` because P2 owned that file), `src/lib/fx/bake.ts`, `src/components/editor/ImportNotes.tsx`. `importPsd` → `buildDesignFromPsdResult(result, fileName, { saveAsset })`. `Design.importReport` and the `ImportIssue` type are in `model.ts`. `job.ts` gained `itemsCount` and design-scoped notes state: `openNotes(designId)` bumps `notesRequest` (each request switches to the Layers tab, even when already open), `closeNotes()`; the side panel closes them when the design changes or it unmounts. The toast's "View details" opens the notes in the Layers tab; rows with items get an info badge; "Import notes (n)" sits under the layer list.
- **Mapping defaults.** When a file omits an effect's blend mode, shadows default to multiply and glows to screen (Photoshop's defaults); everything else normal. `present: false` entries are skipped. Linear contours (every point x≈y) are dropped. Midpoints of 50% and the first stop's midpoint are omitted. Effect sizes are capped at 250 px. Gradient overlay `type` → `style`, stroke gradient style from its `ExtraGradientInfo`. Descriptor grey (`{k}`) and CMYK are ink percent (0..100, 0 = white); text engine colours use ag-psd's 0..255 scale (`textColorHex`: CMYK ink /255, grey = grey level, 0 black). Non-finite numbers never reach the model (clamp maps NaN to the low end; NaN stop locations sort as 0; non-finite contour points are dropped), and blend/justification lookups use own keys only. Outer glow `technique` is not in ag-psd's types but its generic descriptor parser reads/writes `GlwT`, so it round-trips (binary test). `dpi` uses `resolutionInfo.horizontalResolution` (×2.54 for PPCM). Glow `noise`/`jitter`/`range ≠ 0.5` (ag-psd gives fractions) → kept editable plus an "approximated" issue.
- **Order.** Effect arrays keep ag-psd's order (index 0 drawn at the bottom). Whether Photoshop stores multi-effects top-first is **deferred: needs real Photoshop file**.
- **Bake order** (bottom → top): pattern overlay, gradient overlays, colour overlays, satin, inner glow, inner shadows, bevel, strokes (with stroke emboss the bevel moves above the strokes). Everything up to the topmost unsupported kind is baked, kinds above stay editable, and drop shadows and outer glow always stay editable — except when fill opacity < 1: then **everything** is baked (outer effects too, under the body) and `fillOpacity` is dropped, because editable shadows would otherwise be computed from the faded alpha. A stroke kind with any pattern/noise entry is baked as a whole. Interior bakes run in shape-relative space like `renderEffects`; supported interior effects are rendered by `renderEffects` itself (isolated, fill 0) so baked and live looks match. Edge-based bakes get ≥ 1 px padding so the distance field sees the edge at the layer bounds.
- **Bevel** height = smoothstep (chisel hard: linear) of distance/size per style (inner, outer, emboss, pillow; stroke emboss = inner on the post-stroke alpha), × `strength`, blurred by `soften`; Lambert shade against (angle, altitude), highlight `delta/(1−sin alt)`, shadow `−delta/sin alt`. Texture and gloss contour are ignored (texture gets an issue). **Satin**: |blur(A shifted +d) − blur(A shifted −d)|, invert optional, contour ignored. **Patterns** tile from the document origin minus `phase`, at `scale`; missing → 50% grey + issue. **Noise gradients**: 13-stop seeded random ramp between min/max per channel (colour model treated as RGB) + issue.
- **Caps.** Bake raster ≤ `MAX_BAKE_PIXELS = 6M` (matching the fx pipeline's 6M, not 16M, for memory). Above it the unsupported effects are dropped with a "dropped" issue (no downscaling); `w × h` is checked before the Float32 raster is made, and the bake throws `BakeTooLargeError` when padding pushes it over. Any other bake error is reported as "Couldn't bake <effects>; it was left out."
- **Report.** `design.importReport` is written when there are notes or items, and its notes start with the per-kind summary (the toast adds "See Import notes in the Layers panel."). `ImportNotes` maps element → page once per pages change.
- **Text** layers stay editable text: supported effects, blend and fill kept; unsupported effects are **dropped** with a note (not baked), and the file is lossy.
- **Groups** are still flattened (P4): group effects and non-pass-through group blend modes become "dropped" items with no element id (`PsdResult.layerIssues`); group opacity still multiplies into children.
- **Lossy** (P3.5) is set only by visible dropped/approximated items and the remaining old notes (clipping, vector masks, adjustments, empty fill layers); baking alone doesn't add the reference composite.
- **Calibration (P3.6)**: no constants changed. Generated-fixture checks added (smoothness 0.5 gradient keeps 0..1 locations; bevel/satin/pattern geometry tests). Visual tuning against Photoshop and the real-file `Lctn`/`Intr` check remain **deferred: needs real Photoshop file**.
- **Tests:** `tests/import/{convert,psd-effects,psd-bake,report}.test.ts`, `tests/fx/bake.test.ts`. ag-psd writes `"linear height"` as normal, so that case builds the parsed object directly. 16-bit is covered by a parsed `Uint16Array` layer (ag-psd writes 8-bit only). The browser check used a node-generated PSD opened through Open file.

---

# Phase 4: Structure (groups, clipping, vectors, vector masks, rich text, smart objects)

**Goal:** Nested groups with their own opacity, blend, effects, hidden and locked state. PSD clipping and a generic "clip to layer below". Vector shapes (fill, stroke and resize editable; no point editing) and vector masks. Multi-run text (rendered; toolbar edits apply to the whole box). Smart objects with their original raster.

### Data model (decided)

The page stays a flat `elements` array (z-order, bottom first). Group membership stays the `groupId` field, now meaning **parent group element id**. A new element type `group` is the container. This keeps `update`, `reorder`, `remove`, history and IndexedDB patches working.

```ts
export const GroupElement = z.object({
  ...base,                       // x,y,width,height = derived union bbox of descendants (syncGroupBounds); rotation always 0
  type: z.literal("group"),
  collapsed: z.boolean().optional(),   // LayersTab only
  // blendMode defaults to "pass-through" for groups (undefined = pass-through)
});
// added to base (all elements):
clipped: z.boolean().optional(),           // clip to the nearest non-clipped sibling below (PSD clipping)
vectorMask: VectorMask.optional(),         // P4.4
```

Invariants, enforced by `normalizeTree(elements)` after every `mutate`:
1. A group element sits directly **above** its descendants, which are contiguous.
2. `groupId` references an existing group element or is null; dangling references are nulled.
3. A group with no children is removed.
4. A `clipped` element whose base is a group or a non-clipped sibling stays; one at the bottom of its parent is set unclipped.
5. Group bounds are synced.

Interaction (decided, minimal change): selection and the transformer still operate on **leaf** elements. Clicking any leaf selects all leaves of its outermost group (today's `withGroups`, generalized to descendants). LayersTab rows for groups select their leaves. Group-level properties (opacity, blend, effects, hidden, locked) are edited when the selection equals exactly one group's leaves; ContextToolbar then shows a "Group" scope toggle ("Group" vs "Each layer"), and in "Group" scope `upd` targets the group id.

Rendering (decided):
- `buildRenderTree(elements)` → `RenderNode = { el: Element; children?: RenderNode[]; clipBase?: boolean; clipped?: RenderNode[] }` (clipped siblings attach to their base).
- `GroupNode` renders a Konva `Group`. A group that **needs isolation** (opacity < 1, blend ≠ pass-through, any effects or a vectorMask) is cached: `node.cache({ x, y, width, height, pixelRatio })`, with an explicit rect from the union of the children's `visualBounds` plus the group's `fxPadding`, because Konva's own clientRect would crop effects. The group's own effects then come from an fx shape drawn from the cache canvas. Implementation: the cached group is set `visible: false` for the scene but kept for hits, plus a sibling fx Shape whose content raster is the group cache. That reuses P1 unchanged.
- Recache when any descendant changes (a `useLayoutEffect` keyed on the descendants' object identities) and every animation frame during a descendant drag or transform (via `useView.transforming` / drag state, throttled with rAF).
- Pass-through groups with opacity 1 and no effects render as a plain Konva Group, with no cache.
- **Clip stack:** base + clipped are drawn inside an isolated cached group as:
  `[base body (fx part "body")] → [each clipped element, with its blend] → [base alpha mask: base content drawn with globalCompositeOperation "destination-in"]`.
  The base's **outer** effects (part "outer") render just below the stack, outside the cache. Clipped elements with native blends work directly. Non-native ones use readback against the cache canvas, which is correct because `sceneFunc` draws into the cache context.
- Exports: `renderPageCanvas`, `renderElementsCanvas` and `renderElementLayer` build the same tree imperatively via a shared `buildTree(Konva, nodes, images)` in `render.ts`, and cache isolated groups before `toCanvas`.

Vector element:

```ts
export const Knot = z.object({ x: z.number(), y: z.number(), inX: z.number(), inY: z.number(), outX: z.number(), outY: z.number() }); // local units
export const Subpath = z.object({ closed: z.boolean(), knots: z.array(Knot).min(1).max(5000), op: z.enum(["combine","subtract","intersect","exclude"]).default("combine") });
export const VectorElement = z.object({ ...base, type: z.literal("vector"),
  subpaths: z.array(Subpath).min(1).max(500), fillRule: z.enum(["nonzero","evenodd"]).default("nonzero"),
  fill: Paint.nullable(), stroke: Paint.nullable(), strokeWidth: z.number().min(0).max(1000).default(0),
  strokeAlign: z.enum(["inside","center","outside"]).default("center"),
  lineCap: z.enum(["butt","round","square"]).default("butt"), lineJoin: z.enum(["miter","round","bevel"]).default("miter"),
  dash: z.array(z.number().nonnegative()).max(16).optional() });
export const VectorMask = z.object({ subpaths: z.array(Subpath).min(1).max(500), fillRule: z.enum(["nonzero","evenodd"]).default("nonzero"), invert: z.boolean().default(false) });
```

Rich text:

```ts
export const TextRun = z.object({ length: z.number().int().positive(), fontFamily: z.string().optional(), fontSize: z.number().positive().optional(),
  bold: z.boolean().optional(), italic: z.boolean().optional(), underline: z.boolean().optional(), strike: z.boolean().optional(),
  fill: Color.optional(), letterSpacing: z.number().optional(), baselineShift: z.number().optional() });
// TextElement gains: runs: z.array(TextRun).max(2000).optional()  // overrides of the element defaults; sum(length) == text.length
```

Smart objects: `ImageElement` gains `source?: { kind: z.enum(["smart-object"]), name: z.string().max(200), transform: z.array(z.number()).length(8).optional() }`. For an embedded linked file of raster type (PNG, JPEG, WebP), the original is stored as the asset and drawn with the affine transform (rotation and scale exact; an 8-point non-affine transform or `warp` is baked from the layer pixels instead, with a note). An embedded PSD, AI or PDF smart object uses the layer pixels plus a note.

### Task P4.1: Group element, tree helpers and migration to version 3

**Files:**
- Create: `src/lib/tree.ts`
- Modify: `src/lib/model.ts` (`GroupElement`, `clipped` in base, `Element` union, `FORMAT_VERSION = 3`)
- Modify: `src/lib/migrate.ts` (2→3: for each distinct `groupId` with no group element, insert `{ type: "group", id: groupId, name: "Group", … }` directly above the topmost member and make the members contiguous below it, keeping their relative order. A group of one is dissolved)
- Modify: `src/store/editor.ts` (`mutate` runs `normalizeTree` + `syncGroupBounds` on every page; `withGroups` → `expandToLeaves(page, ids)` over the outermost ancestors; `group(ids)` creates a group element; `ungroup` removes one level; `remove` of all leaves of a group removes the group; `cloneWithNewIds` remaps group ids and copies group elements; `reorder`/`moveTo` move a whole group block)
- Modify: every `switch (el.type)` / `el.type ===` site so that `group` is handled (render returns `[]` for group leaves; `pageFonts`, `usedAssets`, `normalize` and the ContextToolbar type checks skip groups). Enumerate the sites with `grep -rn "\.type ===\|case \"" src`.
- Modify: `src/components/editor/actions.ts:147` (`placeSticky` creates a group element)
- Test: `tests/model/tree.test.ts`, `tests/model/migrate.test.ts` (extend), `tests/store/groups.test.ts`

**Interfaces:**
- Produces: `buildRenderTree(els: Element[]): RenderNode[]`, `normalizeTree(els: Element[]): Element[]`, `descendants(els, groupId): Element[]`, `leaves(els, ids): string[]`, `outermostGroup(els, id): string | null`, `syncGroupBounds(els): Element[]`, `parentChain(els, id): string[]`.
- [ ] **Step 1: Write the failing tests.**
  - "v1 design migrates with groups and renders unchanged": 3 elements, two sharing `groupId: "g1"`. After migration there are 4 elements, the group is above its members, the members keep their order, and `renderPageCanvas` (jsdom) is pixel-identical to the pre-migration render.
  - "normalizeTree repairs non-contiguous children" and "drops empty groups" and "nulls dangling groupId".
  - "nested group selection expands to all leaves of outermost".
  - "ungroup removes one level only".
  - "reorder moves whole group block".
  - "duplicate group copies group element with new ids and remapped children".
  - "workfile keeps tree elements".
- [ ] **Steps 2–4:** FAIL, implement, PASS. **Step 5:** Commit with `feat(model): nested group elements with migration`.

### Task P4.2: Group and clip rendering

**Files:**
- Create: `src/components/editor/GroupNode.tsx`
- Modify: `src/components/editor/Canvas.tsx` (render `buildRenderTree(page.elements)` recursively instead of `page.elements.map`)
- Modify: `src/lib/render.ts` (`buildTree` for exports; `needsIsolation(group)`; clip stack assembly; `renderElementsCanvas` accepts groups by expanding to the subtree)
- Modify: `src/lib/fx/fxShape.ts` (`part` option honoured; the content source can be a provided canvas for group caches)
- Modify: `src/store/editor.ts` (`clipToBelow(ids)`, `releaseClip(ids)`)
- Modify: `src/components/editor/ContextToolbar.tsx` (a "Clip to layer below" button next to the existing clip-to-shape; it's disabled for the bottom element)
- Test: `tests/render/groups.test.ts` (jsdom)

- [ ] **Step 1: Write the failing tests.**
  - "group opacity isolates overlap": two overlapping opaque red rects in a group at 50% opacity. The overlap pixel equals a non-overlap pixel (isolated), whereas an ungrouped pair at 50% each would differ.
  - "group multiply blends composite with page".
  - "group drop shadow wraps children union".
  - "clipped element only shows inside base alpha": a blue rect clipped to a red circle. Outside the circle the pixel is the page bg; inside it's blue.
  - "clip base outer shadow not clipped".
  - "hidden group hides children".
  - "pass-through group with opacity 1 does not cache" (spy on `Konva.Group.prototype.cache`).
- [ ] **Steps 2–4:** FAIL, implement, PASS. Manual check with the `run` skill: drag a child of an isolated group (the cache refreshes smoothly) and edit the clip.
- [ ] **Step 5:** Commit with `feat(editor): group opacity, blend and effects; clip to layer below`.

### Task P4.3: LayersTab tree

**Files:**
- Modify: `src/components/editor/SidePanel.tsx` (`LayersTab` renders a tree: indentation per depth, a collapse chevron on groups, a clipped-arrow glyph on clipped rows, drag a row onto a group to reparent it (`st.reparent(id, groupId | null, index)`), and drag between rows to reorder within the same parent)
- Modify: `src/store/editor.ts` (`reparent(id, parentId, indexInParent)`)
- Test: `tests/store/reparent.test.ts`
- [ ] Tests: "reparent into group keeps tree valid", "reparent group into its own descendant is rejected", "reparent preserves z among siblings". Then implement, run the manual drag-and-drop check, and commit with `feat(editor): layers tree with groups and clipping`.

### Task P4.4: Vector element and vector masks

**Files:**
- Create: `src/lib/vector.ts`
- Modify: `src/lib/model.ts` (`VectorElement`, `VectorMask` in base)
- Modify: `src/lib/render.ts` (`baseNodes` for `vector`: one `Shape` whose `sceneFunc` traces the subpaths via `traceSubpaths(ctx, subpaths)`. Boolean ops are rendered by drawing each subpath into an offscreen canvas with `source-over`, `destination-out`, `destination-in` or `xor` for combine, subtract, intersect and exclude. Fill paint: colour, or a gradient via `sampleGradient` → pattern. Stroke alignment: inside = clip to path then stroke 2w; outside = stroke 2w then `destination-out` the fill. A `vectorMask` on any element is applied in the fx content-raster stage as a clip (invert → evenodd with an outer rect). `needsFx` returns true when `vectorMask` is set)
- Modify: `src/components/editor/Canvas.tsx` (transform end for `vector` scales the knots, like `path` points)
- Modify: `src/components/editor/ContextToolbar.tsx` (the vector section has fill and stroke paint with a colour/gradient switch, stroke width and alignment; a "Release vector mask" action)
- Test: `tests/model/vector.test.ts`, `tests/render/vector.test.ts`
- Scope (user decision): vectors are editable for fill, stroke and resize only. No knot/bezier point editing tool, no handle overlays; that is out of scope (future).

**Interfaces:**
- Produces: `traceSubpaths(ctx: PathCtx & { bezierCurveTo }, subpaths: Subpath[]): void`, `vectorBounds(subpaths): { x; y; width; height }`, `scaleSubpaths(subpaths, sx, sy): Subpath[]`, `translateSubpaths(subpaths, dx, dy)`, and `shapeToVector(el: ShapeElement): VectorElement` (enables a "Convert to vector" action, which also enables vector export in P6b).
- [ ] Tests: "bounds of a cubic include control-extrema not control points", "subtract op leaves hole (pixel transparent)", "evenodd ring", "outside stroke paints outside only", "vector mask clips image", "inverted mask", "scale on resize". FAIL, implement, PASS. Commit with `feat(editor): vector shapes and vector masks`.

### Task P4.5: Import structure from PSD

**Files:**
- Create: `src/lib/importers/psdStructure.ts`
- Modify: `src/lib/importers/psdConvert.ts` (emit a **tree** of nodes instead of a flat list: `PsdNode.children?: PsdNode[]`, `kind: "pixel" | "text" | "group" | "vector"`, `clipping`, `vectorMask`, `vector`; stop multiplying group opacity into children; stop releasing clipping)
- Modify: `src/lib/importers/psd.ts` (walk the tree in order, producing group elements and `groupId`s; `clipped` from `layer.clipping`; layer masks stay baked into alpha as today; group effects, blend and fillOpacity mapped like layers. Photoshop group fillOpacity is ignored and noted)

Mappings:
- **Vector shape layers** (`vectorFill` + `vectorMask` (paths) + optional `vectorStroke`, and `vectorOrigination` for live shapes): build a `vector` element from `vectorMask.paths`. ag-psd knot `points` are `[inX, inY, x, y, outX, outY]` in document pixels; test the order with generated fixtures (real-file confirmation deferred: needs real Photoshop file). Convert to element-local coordinates with `x = minX` and similar. `BezierPath.operation` → `op`, `fillRule: "even-odd" → "evenodd"`. Fill: `vectorFill.type === "color"` → Paint colour; solid gradient → Paint gradient; pattern or noise → keep the pixel layer (bake) plus a note. Stroke: `vectorStroke.strokeEnabled`, `lineWidth`, `lineAlignment`, `lineCapType`, `lineJoinType`, `lineDashSet` (× lineWidth), `content` → Paint. `fillEnabled:false` → `fill: null`. The vector element replaces the pixels; the pixel data is dropped.
- **Vector masks on non-shape layers** (`vectorMask` without `vectorFill`): `vectorMask` on the element, with paths made element-local. `vectorMask.invert` and `disable` (→ skip) are honoured.
- **Text style runs:** `text.styleRuns` → `runs` (font via `matchFont` per run, size × `yy` × scale, fillColor, fauxBold/fauxItalic, underline, strikethrough, tracking → letterSpacing, baselineShift). The element defaults come from the run covering the most characters. Runs equal to the defaults are omitted. `paragraphStyleRuns` with mixed alignment uses the first alignment and adds a note.
- **Rotated text** (transform with rotation but no skew): text element with `rotation = atan2(xy, xx)` instead of rasterizing. Skewed, warped, vertical or on-path text is still rasterized with a note.
- **Smart objects:** as in the data model; `placedLayer.transform` → affine (rotation, scale and position) when the 4 corners form a parallelogram. `psd.linkedFiles` (only when `skipLinkedFilesData` is false; change it to false only when `placedLayer` exists, which takes a second read pass, since the read option is file-wide) → for a raster mime, the asset is the original file. Filters on a smart object (`placedLayer.filter`) → layer pixels plus a note.

- [ ] **Step 1: Write the failing tests** (`tests/import/psd-structure.test.ts`, fixtures via `buildPsd`):
  - "nested groups become nested group elements with opacity on the group" (not multiplied).
  - "clipping layer is clipped to base".
  - "vector rect layer becomes vector element with colour fill and exact knots".
  - "vector stroke maps alignment and width".
  - "vector mask on pixel layer kept and local".
  - "two style runs become runs with correct lengths summing to text length".
  - "rotated point text becomes rotated text element".
  - "smart object with png linked file uses original and transform rotation 30°" (build `linkedFiles` with a tiny PNG made from bytes).
  - "group blend multiply kept; pass through default".
- [ ] **Steps 2–4:** FAIL, implement, PASS. **Step 5:** Commit with `feat(import): psd groups, clipping, vector shapes, masks, rich text, smart objects`.

### Task P4.6: Rich text rendering and editing

**Files:**
- Create: `src/lib/richText.ts`
- Modify: `src/lib/render.ts` (`baseNodes` for text: when `runs` has more than one distinct style, emit a `Shape` drawing `layoutRichText` instead of `Text`)
- Modify: `src/store/editor.ts` (`normalize` measures the rich layout height)
- Modify: `src/components/editor/TextEditor.tsx` (on commit: `runs = remapRuns(oldText, newText, runs)`)
- Modify: `src/components/editor/ContextToolbar.tsx` (when runs exist, a property change applies to the whole element and removes that property from every run; a "Mixed" label appears in the font picker and size field)
- Test: `tests/model/richText.test.ts` (jsdom for measurement)
- Scope (user decision): runs are kept and rendered, and survive text edits via `remapRuns`. Toolbar edits always apply to the whole text box. Selecting a word or range in `TextEditor` to restyle it is out of scope (future).

**Interfaces:**
- Produces: `layoutRichText(el: TextElement, measure: (text: string, font: string, letterSpacing: number) => number): { lines: { y: number; height: number; baseline: number; spans: { x: number; text: string; style: ResolvedRun }[] }[]; height: number }`, `drawRichText(ctx, layout, el)`, `remapRuns(oldText: string, newText: string, runs: TextRun[]): TextRun[] | undefined`. The algorithm: common prefix and suffix; the inserted middle takes the style of the run at the insertion point; deleted ranges shrink runs; zero-length runs are removed; and a single run equal to the defaults collapses to undefined.
- Layout rules mirror Konva.Text so plain and rich text match: word wrap at element width, `lineHeight × max fontSize on the line`, and `align`.
- [ ] Tests: "remapRuns insert inside run extends it", "delete across runs", "replace all collapses to defaults", "layout wraps across run boundary", "rich layout height equals Konva.Text height for single-style text (±1px)". FAIL, implement, PASS. Commit with `feat(editor): multi-style text runs`.

**P4 risks:** The biggest phase. The leaf-selection model means a group can't be rotated as a unit when its children have different rotations; that's acceptable (the transformer already handles multi-node rotation). Cache memory for large isolated groups: apply the 16 M px cap with a lower cache ratio. The cache must refresh after async image and font loads, so include `fontsVersion` and image readiness in the recache deps. Changing `skipLinkedFilesData` doubles parse memory for files with smart objects; do the second pass only when needed.

### P4a notes (groups; implemented 2026-10-26; these win over the P4 text above)

Scope: P4.1 + the group half of P4.2/P4.3/P4.5 and the group folders of P6b. Not done (later P4 steps): `clipped`/clip stacks and "Clip to layer below", vector elements and vector masks, rich text, smart objects.

- **Files.** `src/lib/tree.ts` (pure: `buildRenderTree`, `normalizeTree`, `syncGroupBounds`, `tidyTree` = both, `parentChain`, `outermostGroup`, `descendants`, `leafIds`, `expandToLeaves`, `effectiveFlags`, `selectedGroup`, `coveredElements`, and the edits `reorderTree`, `reparentTree`, `groupIds`, `ungroupIds`, `makeGroup`), `src/lib/fx/groupDraw.ts` (`needsIsolation`, `setGroupDraw`, `groupDrawFor`), `src/components/editor/GroupNode.tsx` (`LayerTree` + `GroupNode`). Tests: `tests/model/{tree,migrate,workfile-tree}.test.ts`, `tests/store/groups.test.ts`, `tests/render/groups.test.ts`, `tests/import/psd-structure.test.ts`, group cases in `tests/export/psd-roundtrip.test.ts`.
- **Model.** `GroupElement` = base + `type: "group"` + `collapsed?`. No `clipped` field yet. `FORMAT_VERSION = 3`. Group `blendMode` undefined = pass-through; `"normal"` is kept explicitly (it isolates). Group `fillOpacity` is never set (PSD group fill is dropped with a note).
- **Tree rule.** Siblings keep list order; a group block goes where its group element sits (the element is the anchor). `normalizeTree` returns the *same array* when valid (cheap check for callers/tests); it nulls dangling/self/cyclic `groupId`s and drops groups with no leaf. The store runs `tidyTree` on every page after every `mutate` and on `load` (1050 layers in nested groups tidy in well under 30 ms, test-asserted).
- **Migration 2→3** (`migrate.ts`, runs in `store.load`, `storage.loadDesign/listDesigns` and `importWorkfile`): each shared `groupId` with ≥2 members and no element of that id becomes a group element with that id, directly above the members, which are gathered at the *topmost* member's place (a non-member that sat between members ends up below the block). A group of one is dissolved; a `groupId` pointing at an existing group element is kept. Idempotent, input not mutated, render-identical for contiguous groups (test).
- **Selection** (decided variant). Selection holds leaves only. `select(ids, additive, deep)`: canvas click selects the outermost group's leaves (as planned); `deep` (Layers rows, Ctrl/Cmd-click, double-click on a member, import-notes badge) selects exactly that leaf or that group's leaves, so members of imported PSD groups can be edited one by one. Group-level opacity/blend/effects are edited when `selectedGroup(els, selected)` finds a group whose leaves equal the selection (outermost when nested with nothing else): the toolbar shows a "Group / Each layer" toggle; in Group scope Transparency, Blend (with "Pass through") and the Effects panel target the group id, and Fill is hidden. Locked/hidden are *effective* through ancestors (`effectiveFlags`, `lockedIds` in the store): a locked group's members don't drag, nudge, delete or transform.
- **Store edits.** `group` nests the selection's units (largest wholly-selected subtrees) into a new group inside their nearest common parent, at the topmost unit's place; `ungroup` dissolves wholly-covered groups one level; `reorder` moves units within their own parent (a whole group moves as a block; a member never leaves its group by reorder); `reparent(id, parentId, index)` replaces `moveTo` (refuses moving a group into itself/descendant); `remove` of all leaves removes the group (tidy); `duplicate`/copy/paste and Alt-drag copy groups that are wholly covered (`coveredElements`) with remapped ids, while a partly copied member stays in its group. Sticky notes create a real group element. Rasterize keeps the front-most original's `groupId` (the group's own opacity/effects are not baked into it).
- **Rendering (deviation from "Konva cache").** No persistent Konva cache. A group is a Konva Group at the page origin holding its members (members keep page coordinates, so drag/transformer/hit testing are untouched). `setGroupDraw` patches that node's `drawScene`: pass-through + opacity 1 + no effects → Konva's own drawing (no off-screen work). Otherwise **isolated**: members are drawn with `_drawChildren(…, top = group)` into a pooled off-screen Konva SceneCanvas covering the members' live device rect (client rect + members' max fx reach, clipped to the target canvas), then drawn back once with the group's opacity and native blend. Effects or a software blend go through the P1 fx pipeline: `fxShapeAttrs` gained `content` (a raster source) and `contentKey`; the group's content is its members rendered off-screen around the live box, keyed by a hash of the members' JSON + a live node stamp (positions during drag, image readiness) + `fxGeneration` (bumped when any deferred member render lands). So drags redraw isolated groups every frame (plain isolation) or re-render throttled (effects). The group node's Konva opacity/compositing stay default (Konva would multiply them into every member). Exports use the same draw via `buildTree` in `render.ts` (leaves inside groups get `perfectDrawEnabled: false`, the editor's setting, since Konva's buffer canvas assumes the layer canvas).
- **Layers panel.** Tree with indentation, collapse chevrons (`collapsed` stored without an undo step), folder icon, effective-hidden dimming, `role=tree/treeitem`. Drag a row onto the top/bottom part of a row = in front of/behind it in that row's parent; onto the middle of a group row = into the group on top. Drop line / ring indicators.
- **PSD import.** `PsdNode` stays a flat list (not a tree): group nodes have `kind: "group"`, `key`, `collapsed`, and every node has `parent` (replaces `group`), emitted bottom first with each group right after its members, which is the element order. Group opacity, hidden, blend (pass through → undefined, normal → "normal", others mapped) and editable effects are kept on the group element; members are no longer multiplied/hidden by their group. Unsupported group effects (bevel, satin, pattern…) and group fill opacity < 1 are "dropped" items on the group element (groups have no pixels to bake into). Empty groups are dropped by `tidyTree`; items whose element vanished lose their `elementId`. Groups of one are kept.
- **PSD export.** Groups become nested folders from `buildRenderTree` with `opacity`, `hidden`, `opened: !collapsed`, `blendMode` (`"pass through"` for undefined/pass-through, else `BLEND_TO_PSD`) and effects; no pixels are rendered for groups. P6b still owes clipping, vectors and vector masks.
- **Browser check (dev, Chrome).** A v2 IndexedDB design with a flat `groupId` pair + a group of one opened as a Group (2 members) + loose layers; group transparency 50% showed the overlap isolated (no red under yellow); grouped two loose layers (Ctrl+G), dragged that group into the first group, dragged a member into the nested group, ungrouped one level (Ctrl+Shift+G), undo/redo across all of it. Opened a generated nested-group PSD (60% normal "Card" with drop shadow, collapsed pass-through "Badge" with a multiply member, multiply folder): nesting, collapse state, union shadow, pass-through vs isolated multiply all as expected. No console errors or warnings.
- **Review fixes (2026-10-26).** Reach: `groupDrawFor` computes members' reach recursively (a nested group reaches its own fx padding + its members' reach), so an inner group's shadow isn't clipped by an outer isolation canvas (editor and exports). `noteImageReady()` (fxShape) bumps `fxGeneration` when `useAssetImage` resolves, so group effects redraw members whose image lives inside their fx Shape. `drawScene` restores in `finally`; `acquire` takes the pool depth only after the canvas is ready. `collapsed` is ignored by the fx cache key. Tree: nesting is capped at `MAX_DEPTH = 200` in `parentsOf` (a group deeper than that starts at the page; empty cut-off levels are dropped), parent walks are iterative (`upward`), and `parentChain`/`expandToLeaves`/`selectedGroup(s)`/`groupIds`/`reparentTree` build the parent map once (5000 layers well under 50 ms; a 10000-deep chain opens; both test-asserted). `reorderTree` returns the same array for a no-op and the store skips the commit (no empty undo step). Locks are effective everywhere: `reorder`/`group`/`ungroup` drop locked ids, `reparent` refuses moving a locked element or into a locked group (the Layers panel shows no drop target either), `paste` puts a copy whose group is locked at the page, `clipToShape`/`releaseMask`/`canRasterize(els, locked)`/Crop/Erase/Group/Ungroup buttons use `lockedIds`. Toolbar scope: `selectedGroups` lists every group whose leaves equal the selection (outermost first); when a group wraps only another group, the toggle offers each by name plus "Each layer"; the pick resets when the outermost selected group changes. Undo/redo keep the current `collapsed` flags (`keepCollapsed`). Canvas passes a memoized `editingIds`; `GroupNode` memoizes its draw config per node/fontsVersion with an effect keyed on it. PSD import counts layers iteratively and stops past `MAX_LAYERS`. Migration: a flat `groupId` equal to a non-group element's id dissolves (documented, kept).
- **For later P4 steps.** Clip stacks can reuse `groupDraw`'s off-screen helpers (`acquire`/`drawMembers`) and fx `content` sources; the `RenderNode` type has no `clipped` attachment yet. `selectedGroup` / Group scope is where vector-mask and clip actions on groups would hook in. Groups never rotate; `syncGroupBounds` stores AABBs of rotated members. Rasterizing a selection that is a whole isolated group bakes members without the group's own opacity/effects (follow-up: render the group subtree).

### P4b notes (clipping; implemented 2026-10-26; these win over the P4 text above)

Scope: the clipping half of P4.2/P4.3/P4.5 and P6b's `clipping`. Not done: vector shapes/masks, rich text, smart objects.

- **Model.** `clipped?: boolean` on every element (base schema), undefined = not clipped. **No version bump**: `FORMAT_VERSION = 3` was never released (HEAD still writes 1), and P4's data model already puts `clipped` in version 3. An older v3 build would only lose the flag (zod strips it) and draw the layers unclipped. `clipped` is ignored by the fx cache key.
- **Tree** (`tree.ts`). `normalizeTree` also drops `clipped` from the bottom element of every parent (still returns the same array when valid). `clipStacks(nodes)` groups one level into `{ node, clipped[] }` (each clipped sibling joins the nearest non-clipped one below); `buildRenderTree` stays flat, so the Layers panel and PSD export are unchanged. `clipBase(els, id)`; edits `clipIds` (Photoshop's Create Clipping Mask: one unit per parent → clipped to the sibling below; several → all but the lowest clipped to it; wholly selected groups count as one unit) and `releaseClipIds` (a released layer takes the clipped layers above it along; releasing a base releases its stack). The flag is the whole state, as in PSD: reorder/delete/group just recompute stacks (deleting a base clips its layers to the next layer below; grouping a clipped layer alone puts it at the bottom of the new group, so it's released; grouping only the base makes the group the base).
- **Store.** `clipToBelow`, `releaseClip`, `toggleClip` (clip, else release) through `editElements`, so locked ids (`lockedIds`, effective through groups) are dropped and a no-op makes no undo step. `clipToShape` (image → shape mask) gives the masked image the shape's `clipped`; `releaseMask` puts both parts back with the masked image's flag. Rasterize: one clipped element's bitmap stays clipped; several are drawn with their stacks (a clipped one whose base isn't selected draws unclipped).
- **Rendering** (`fx/groupDraw.ts` `setClipDraw`/`clipDrawFor`, reusing the pooled off-screen canvases). A stack is a Konva Group at the page origin holding the base's own node (hits, drag, transformer; never drawn by the stack), the base's **ghosts** (listening-free groups named `cm-clip-outer|body|mask`, built by `render.ts clipGhosts` from the base drawn neutral: opacity 1, no blend, fill opacity and effects kept; the mask is `baseNodes` with no effects/fill) drawn with the base node's *live* transform, and the clipped nodes. Drawing (Photoshop's "blend clipped layers as group"): (1) the base's outer effects straight onto the page, unclipped, with the base's opacity and each part's own blend; (2) off-screen: the base body, then each clipped node drawn over the stack and mixed back by the mask, `before·(1−M) + after·M` (destination-in / destination-out / lighter), so its native or software blend (readback of the off-screen stack) and its own effects are all clipped to the base's **content alpha** (pixels before effects and fill opacity, so a fill-0 base still clips fully); (3) the stack onto the page with the base's opacity and blend (native or `drawBlended`). Deviation from the plan text: no `destination-in` of the whole stack, so the base's own stroke/outer parts aren't cut. A group base: outer/body via `drawWithEffects` with `GroupDraw.part`, mask = its members drawn (so members' effects count, the group's own don't); a pass-through group base is effectively isolated. A hidden base hides the stack; hidden clipped nodes are skipped; clipped groups work. The stack's off-screen rect is the base's live box + its fx reach (clipped content never leaves it). `acquire` now resets globalAlpha/composite on reused canvases (a stack left `destination-out` on a pooled canvas).
- **Editor.** `LayerTree` renders `ClipStackNode` (memo, `setClipDraw` in a layout effect) for stacks; members keep page coordinates, so drag/transform/selection are untouched and the clip follows a drag live. While the base is being edited (text overlay, crop, erase) its ghosts' outer/body are skipped and the clip still shows. Hit testing is not clipped (a clipped layer can be clicked outside its base, like Photoshop's Move tool on layer pixels).
- **UI.** Toolbar "Clip" / "Unclip" (active) next to Mask/Group, from what the store would do. Shortcut Alt/Option+Cmd/Ctrl+G toggles (`isClipShortcut`, physical `KeyG`). Layers: clipped rows indent one step with a `CornerLeftDown` arrow, bases are underlined, and a hover button on each row clips it to the layer below / releases it (hidden for locked rows and the bottom of a parent). Rows of a hidden base's clipped layers are not dimmed (follow-up).
- **PSD import.** `PsdNode.clipped` from `layer.clipping` (layers and groups); no "released" note and not lossy any more. A clipped layer whose base was left out (blank, adjustment, no pixels) is released with a note ("…show in full", lossy); a clipped layer with nothing of its level below it is not clipped (so it never clips to the hidden "Flattened" reference layer). An empty group base is dropped by `tidyTree` and its clipped layers then clip to the next layer below (rare; not noted).
- **PSD export.** `clipping: true` on clipped layers and folders (only when set, so plain layers keep their keys).
- **Tests.** `tests/model/clip.test.ts` (8), `tests/store/clip.test.ts` (12 incl. shortcut), `tests/render/clip.test.ts` (17: inside base alpha, hidden base, order, native and software blend inside the stack, base opacity/fill/blend, base shadow unclipped, clipped effects clipped, group base, clipped group, stack inside an isolated group, masked image as base, rasterize), `tests/import/psd-structure.test.ts` (+5), `tests/export/psd-roundtrip.test.ts` (+1 round trip).
- **Browser check (dev, Chrome).** Generated PSD (circle base with two clipped layers, one multiply; a group base with a clipped gradient) opened clipped as in Photoshop with no import notes; Release from the toolbar released the stack from that layer up; Alt+Cmd+G re-clipped; a row button clipped the multiply layer; dragging a clipped layer stayed clipped live; hiding the base hid its stack. No console errors or warnings.
- **Deferred: needs real Photoshop file.** Whether Photoshop draws the base's interior effects (stroke inside, overlays) under or over clipped layers, and clipping on a pass-through group base, are unverified; we draw the base body (incl. strokes) under the clipped layers and treat a group base as isolated.

### P4c notes (vectors and vector masks; implemented 2026-10-26; these win over the P4 text above)

Scope: P4.4, the vector half of P4.5 and P6b's vectors/vector masks, plus two P4b leftovers. Not done: rich text, smart objects, shapes exported as vectors (`shapeToVector`), a "Convert to vector" action, point/bezier editing (user decision: future).

- **P4b leftovers.** Clip-stack hit testing: `setClipDraw` also patches `drawHit` (`drawClipHit` in `fx/groupDraw.ts`): the base hits as usual; the clipped layers hit into a pooled scratch hit canvas that is `destination-in`ed with the base's own hit region (a group base: its members), then copied onto the layer's hit canvas. So a click outside the base falls through to whatever is below; partially covered edge pixels aren't hit (Konva wants alpha 255). Konva skips hit redraws while dragging, so this costs nothing during drags. The two scratch canvases are per nesting depth (a clipped group can hold a stack whose hits draw inside the outer stack's) and cover only the base's device hit rect (+6 units), grown but never shrunk. The group/stack scene pool keeps canvases up to 16M px between frames (a retina full-page canvas was reallocated every frame at the old 4M). Layers rows: `clipHiddenIds(els)` (`tree.ts`) lists layers clipped to a hidden base (and members of such clipped groups); their rows are dimmed like hidden ones.
- **Model** (`model.ts`, no version bump: version 3 is still unreleased). `Knot`, `PathOp`, `Subpath`, `FillRule`, `VectorMask` (base field `vectorMask?`) and `VectorElement` as planned, with one deviation: `Subpath.op` is **optional**. A subpath with an op starts a new *component*; one without joins the component before it (filled together with the fill rule), which is what ag-psd gives for a compound shape's later subpaths (boolOp −1). The first component always adds (`pathComponents`). Knots are in element-local units; resizing scales knots and masks (`scalePathFields`, Canvas transform end; free aspect for vectors), never the stroke width.
- **Geometry** `src/lib/vector.ts` (pure): `traceSubpaths`, `vectorBounds` (cubic extrema, not control points), `transformSubpaths`/`scaleSubpaths`/`translateSubpaths`, `pathComponents`, `scalePathFields`.
- **Drawing** `src/lib/vectorDraw.ts`. One component, solid fill and no stroke or a solid centred stroke → drawn directly on the target. Anything else is drawn off-screen in local units at the device scale (rounded up to √2 steps, capped 4096 px a side / 6M px): the shape's alpha (each component composited with `source-over`/`destination-out`/`destination-in`/`xor` for combine/subtract/intersect/exclude), the fill paint laid over it with `source-in` (gradients through `sampleGradient` over the element box), the stroke at 2w then `destination-in`/`destination-out` by the shape alpha for inside/outside, with caps, joins and dash. The render is kept per draw closure and scale. The Shape gets a transparent `stroke`/`strokeWidth` so Konva's client rect (transformer, layer boxes) includes centred/outside strokes; `basePad` adds `strokeReach` (3× the outer side for miter joins). The stroke follows every subpath (an intersect/exclude component's edges outside the result get stroked too; approximation). Hits: fill region with path ops (off-screen when compound, on one pooled scratch canvas covering only the element box's device rect), plus the stroke. `ctx.miterLimit` is set from `miterLimit` (absent = 10; imports get Photoshop's value, default 100) and `strokeReach` pads miter joins by side × miterLimit, capped at 10 sides (sharper tips are cut by the padding). Renders (vector layers and vector-masked content) live in one module-level LRU (`vectorRenderCache`: 96 entries / 24M px, canvases released on evict like `fxCache`) keyed by a content hash (`contentKey`, once per element object) + device ratio, so an edit that clones the design reuses them; masked content also keys on the bitmap's identity (a text element keeps a per-closure key: font loads aren't in its content).
- **Vector masks** live in `render.ts baseNodes`: an element with a `vectorMask` becomes one Shape that draws its own nodes (built once with the provided Konva) clipped to the mask when it is one non-inverted component, else off-screen (`toCanvas`) with the mask alpha applied (`destination-in`, or `destination-out` inverted). Because it's in `baseNodes`, effects are computed from the masked content and stay unclipped, clip stacks clip to the masked alpha, and rasterize/exports bake it. Hits are the box clipped to the mask (`clipHitToMask`; an inverted compound mask is approximate for hits). Groups ignore `vectorMask` (import drops a group's mask with a note). Toolbar: "Unmask" (Release vector mask) for a single element with a mask; clip-to-shape isn't offered for an image with a vector mask; Rasterize is offered for one (`canRasterize`). Crop keeps the mask on the picture: `cropTo`, `slidePicture` and `uncrop` (`crop.ts`) translate the mask by how far the picture moved in local units. While the crop editor is open the overlay shows the whole picture unmasked (follow-up).
- **UI** `VectorControls.tsx`: Fill popover (None/Color/Gradient with the Effects panel's `GradientFields`, fill rule) and Stroke popover (paint, width, position, caps, corners, dashed toggle = [3, 2]). **Dashes are in stroke widths** (as Photoshop's `lineDashSet`): drawn as `dash × strokeWidth`, so they scale with the width; imported and exported unchanged. Layers label "Shape".
- **PSD import** `src/lib/importers/psdVector.ts` + `psdConvert`/`psd.ts`. A layer with `vectorFill` + an enabled `vectorMask` becomes `PsdNode.vector` (document px; bounds from `vectorBounds`), unless it has unsupported effects (then the existing pixel bake path) or a pattern/noise-gradient fill or stroke (pixels kept, "baked" item). Knots: `[inX, inY, x, y, outX, outY]`, snapped to 1/1000 px when within 1e-4 (ag-psd's fixed-point error). `operation` → `op` (undefined kept), fill rule: **always non-zero** (ag-psd reads flag 2 as "non-zero", anything else as "even-odd", but Photoshop's usual flag is 1, so nearly every real shape would read even-odd; explicit "non-zero" still maps to non-zero), `fillStartsWithAllPixels` → a document-rect component first. Fill: colour, solid gradient (`psdGradientToModel`), `fillEnabled: false` → null. Stroke: `lineWidth` (Points × dpi/72), alignment, cap, join, `lineDashSet` (stroke widths), `miterLimit` (default 100), `opacity` → colour alpha (`#rrggbbaa`) or multiplied into gradient opacity stops. Live shapes (`vectorOrigination`, one key, types 1/2/5) become `ShapeElement` rect/rounded rect (equal radii)/ellipse only when exact: one path whose bounds match the origin box (±0.5), axis-aligned corners, solid fill, non-zero rule, and no stroke or a solid centred undashed miter stroke; otherwise a vector. A shape layer with an enabled raster `layer.mask` keeps its pixels with the mask applied ("Shape with pixel mask kept as image.", baked): the model can't put a pixel mask on a vector. A file brings in at most `KNOT_BUDGET` (200k) live knots (`takeKnots`, counted in layer order); past it shapes keep their pixels and vector masks are left out, with a note. A mask that starts from all pixels keeps ≤ 499 of its own subpaths (the document rect is the 500th). Pixel layers (and any non-shape layer) keep `vectorMask` (local to the layer box, after bake padding); `disable` skips it, `invert` kept. Text with a vector mask: mask dropped with a note. The old "Vector masks were left out" lossy note is gone.
- **PSD export** (`psdBuild.ts`). Vector → shape layer: `vectorMask.paths` (knots in document px with rotation applied about x,y), `vectorFill` (colour/gradient; black when no fill), `vectorStroke` (`fillEnabled`, `strokeEnabled`, width, align, cap, join, `miterLimit` (absent = 10), dash as `None` units, opacity = stroke colour alpha), plus our rendered pixels (no effects) and the usual effects/blend/fill. Paths are written with ag-psd's "non-zero" (the reader maps it back to non-zero, so the rule round-trips); an even-odd element goes out as the same region in operations (`evenOddAsOps`: the first component's later subpaths each `exclude`; exact unless a subpath crosses itself; a later component's own holes stay joined, approximate) and re-imports as non-zero. Pixels never double what's written live (`pixelsOnly`): a vector's pixels are rendered without its stroke (Photoshop draws `vectorStroke`), any other layer's without its `vectorMask` (a vector's own mask isn't written, so it stays baked). No `vectorOrigination` (the P6 risk). A fill colour's alpha is dropped (no place for it). `vectorMask` on any other element → layer `vectorMask` (+`invert`). Shape elements are still pixel layers (P6b's `shapeToVector` not done), so a live rect re-imports as an image.
- **Tests.** `tests/model/vector.test.ts` (8: bounds incl. extrema/closing segment, transforms, components, schema, resize), `tests/render/vector.test.ts` (16: fill, curve, subtract/intersect/exclude, evenodd ring, outside/inside/centre stroke + dash, gradient, resize, effects + multiply, vector clip base, masks incl. inverted/compound/effects from masked content), `tests/render/clip-hit.test.ts` (4), `tests/model/clip.test.ts` (+1 `clipHiddenIds`), `tests/import/psd-vector.test.ts` (17), `tests/export/psd-roundtrip.test.ts` (+4: knots ±0.01 px with ops/rule/stroke/gradient/dash/effects, no fill, rotation, masks on shape and image). Fixtures: `vectorEl`, `rectPath`, `corner` (design), `shapeLayer`, `polyPath` (psd).
- **Browser check (dev, Chrome).** Generated PSD (`p4c-shapes.psd`: a curved blob with a subtracted hole and an outside round stroke, a live rectangle, a gradient star with a dashed centred stroke, a photo with an elliptical vector mask): all opened as expected (live rect as a shape). Resized the star (side handle, non-uniform) and the masked photo (mask scaled with it), switched the star's fill to radial, stroke to outside/round/undashed, added a drop shadow; Download > PSD and reopened: blob and star came back as vectors with ops, gradient, stroke and shadow, the photo with its mask. No console errors or warnings.
- **Review fixes (2026-10-26).** Tests: `tests/import/psd-vector.test.ts` (+4: shape + pixel mask, miter limit default, 500-subpath cap, knot budget; even-odd flag reads non-zero, dash/miter mapping), `tests/export/psd-roundtrip.test.ts` (+2: fill rule incl. even-odd as exclude ops, pixels without live stroke/mask; miter/dash), `tests/render/clip-hit.test.ts` (+2: nested stacks, small stack edges), `tests/render/vector.test.ts` (+4: dash units, miter limit, `strokeReach`, shared cache + release), `tests/model/crop-mask.test.ts` (4), `tests/store/rasterize-check.test.ts` (1). `LayerTree` memoizes `clipStacks(nodes)`; `ClipGhosts` is memoized. Browser check (dev, Chrome, generated PSD): a shape with a half-hiding pixel mask opened as an image with its right half; a circle base with a clipped group holding its own clip stack drew and hit right (inner clipped layer inside both bases, the circle where the group is empty, the layer below outside the circle); cropping the left of an elliptically masked photo left the ellipse in place on the page. No console errors.
- **Deferred: needs real Photoshop file.** What the subpath flag (ag-psd's fill rule) means, and whether Photoshop ever writes 2; knot order semantics, whether Photoshop strokes a compound shape's result outline (we stroke every subpath), live-shape origin key types (1 rect, 2 rounded rect, 5 ellipse) and whether shape-layer pixels already carry the stroke (we never re-mask a shape layer's own pixels), and how Photoshop treats a first component with subtract.

---

# Phase 5: Adjustments, filters and artboards

**Goal:** Non-destructive adjustment layers that affect what's beneath them in their parent (or only their clip base). Per-element filters. PSD artboards become pages.

### Model

```ts
export const Adjustment = z.discriminatedUnion("type", [
  z.object({ type: z.literal("brightness-contrast"), brightness: z.number().min(-150).max(150), contrast: z.number().min(-100).max(100), legacy: z.boolean().default(false) }),
  z.object({ type: z.literal("levels"), channels: z.record(z.enum(["rgb","r","g","b"]), LevelsChannel) }), // inBlack,inWhite 0..255, gamma 0.1..9.99, outBlack,outWhite
  z.object({ type: z.literal("curves"), channels: z.record(z.enum(["rgb","r","g","b"]), z.array(z.object({ x: z.number(), y: z.number() })).min(2).max(16)) }),
  z.object({ type: z.literal("exposure"), exposure: z.number(), offset: z.number(), gamma: z.number().positive() }),
  z.object({ type: z.literal("vibrance"), vibrance: z.number().min(-100).max(100), saturation: z.number().min(-100).max(100) }),
  z.object({ type: z.literal("hue-saturation"), colorize: z.boolean().default(false), master: HSL, ranges: z.array(HueRange).max(6).optional() }),
  z.object({ type: z.literal("color-balance"), shadows: CB, midtones: CB, highlights: CB, preserveLuminosity: z.boolean() }),
  z.object({ type: z.literal("black-white"), weights: z.object({ reds, yellows, greens, cyans, blues, magentas }), tint: Color.optional() }),
  z.object({ type: z.literal("photo-filter"), color: Color, density: z.number().min(0).max(1), preserveLuminosity: z.boolean() }),
  z.object({ type: z.literal("channel-mixer"), monochrome: z.boolean(), r: Mix, g: Mix, b: Mix }),
  z.object({ type: z.literal("invert") }),
  z.object({ type: z.literal("posterize"), levels: z.number().int().min(2).max(255) }),
  z.object({ type: z.literal("threshold"), level: z.number().int().min(1).max(255) }),
  z.object({ type: z.literal("gradient-map"), gradient: Gradient, reverse: z.boolean().default(false) }),
]);
export const AdjustmentElement = z.object({ ...base, type: z.literal("adjustment"), adjustment: Adjustment,
  rasterMask: z.object({ assetId: z.string(), x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }).optional() });
export const Filter = z.discriminatedUnion("type", [
  z.object({ type: z.literal("blur"), radius: z.number().min(0).max(250) }),
  z.object({ type: z.literal("adjust"), adjustment: Adjustment }),   // any adjustment applied to the element only
  z.object({ type: z.literal("sharpen"), amount: z.number().min(0).max(5), radius: z.number().min(0.1).max(50) }),
  z.object({ type: z.literal("noise"), amount: z.number().min(0).max(1), mono: z.boolean() }),
]);
// base gains: filters: z.array(Filter).max(20).optional()
```

Unsupported adjustments: `selective color` and `color lookup` are **dropped** with a note, and the reference composite is kept (`lossy`). They can't be baked: an adjustment depends on the layers below it, so baking would mean merging layers, which is against "keep editable".

### Rendering (decided)

An adjustment element is a Konva `Shape` with `listening: false` (selectable from LayersTab only). Its `sceneFunc`:
1. Takes the device rect of its box (an imported adjustment covers its full page, per `pageSize`) intersected with the canvas.
2. Reads the backdrop with `readBackdrop`. This is the composite of everything already drawn in the current context: within an isolated group cache, that's the group's content below it; in a pass-through group or at page level, that's everything below it, which matches Photoshop's pass-through semantics.
3. Applies `applyAdjustment(imageData, adj)`.
4. Coverage = `rasterMask` sampled × opacity.
5. Blends with its blendMode and writes back via `writeBackBlended`.

Clipped adjustments live inside the clip-stack cache, so the final `destination-in` limits them to the base. Filters run in the fx content stage before effects, and `needsFx` is true when `filters` is set.

### Task P5.1: Pixel operations

**Files:** Create `src/lib/fx/adjust.ts`. Test `tests/fx/adjust.test.ts`.
- **Interfaces:** `applyAdjustment(d: { data: Uint8ClampedArray; width: number; height: number }, a: Adjustment): void` (in place, straight RGBA, alpha untouched). `buildLut(a)` for per-channel ops. `monotoneCurve(points): (x: number) => number` (Fritsch–Carlson monotone cubic, written from the published description). `applyFilter(r: Raster, f: Filter, ratio: number): Raster`.
- Formulas (decided, each documented in code):
  - Brightness/contrast (non-legacy): brightness shifts midtones through a curve `y = x + b·(1 − |2x−1|)·k`, and contrast is an S-curve around the mean 0.5. Legacy is linear.
  - Levels: `out = outB + (outW−outB)·((x−inB)/(inW−inB))^(1/γ)`.
  - Hue/saturation in HSL with Photoshop-style range weights (`a,b,c,d` feather points on the hue wheel).
  - Vibrance scales saturation by `(1 − s)` and protects skin hues.
  - Colour balance: tonal weights by luminance, with optional luminosity preservation.
  - Black & white: hue-weighted luminance, then the tint.
  - Photo filter: multiply-blend toward the colour by density, then optionally restore luminosity.
  - Gradient map: luminance → `sampleGradient` in 1D.
  - Exposure: `x·2^e + offset`, then `^(1/γ)` in linear light.
  - Blur reuses `gaussianBlur` on all channels (premultiplied).
- [ ] Tests (one per type, 3 sample colours each): known outputs computed by hand in the test with the same formula comment, plus "levels identity is identity", "curves identity is identity", "invert twice is identity", "threshold 128 splits", "posterize 2 levels gives 0/255", "gradient map black→white equals grayscale luminance ±1", "blur keeps premultiplied edges (no dark halo)". FAIL, implement, PASS. Commit with `feat(fx): adjustment and filter pixel operations`.

### Task P5.2: Adjustment element rendering and filters

**Files:**
- Modify: `src/lib/model.ts` (`AdjustmentElement`, `Filter` and base `filters`)
- Modify: `src/lib/render.ts` (`baseNodes` for `adjustment`; `buildTree` passes it through)
- Modify: `src/lib/fx/fxShape.ts` (filters stage)
- Modify: `src/store/editor.ts`, `src/lib/model.ts usedAssets` (an adjustment `rasterMask.assetId` counts as used)
- Test: `tests/render/adjust.test.ts` (jsdom)
- [ ] Tests:
  - "invert adjustment inverts layers below only": page bg white, red rect, invert adjustment, then a blue rect on top. The red area becomes cyan, the top blue stays blue, and the bg becomes black.
  - "adjustment inside isolated group affects only group content".
  - "clipped adjustment affects base only".
  - "raster mask limits effect".
  - "opacity 50% halves".
  - "blur filter on image softens edge".
  FAIL, implement, PASS. Commit with `feat(render): non-destructive adjustment layers and filters`.

### Task P5.3: Adjustment and filter UI

**Files:** Create `src/components/editor/AdjustmentPanel.tsx`. Modify `ToolStrip.tsx` or `SidePanel.tsx` (an "Adjustments" add menu that inserts a full-page adjustment above the selection, or at the top), `ContextToolbar.tsx` (for an adjustment selection: the panel; for other elements: a "Filters" popover with blur, sharpen, noise and "Adjust colours" via any `Adjustment`), and `SidePanel.tsx` (LayersTab icon per adjustment type). Curves editor: a 256×256 SVG with draggable points; levels: three numeric inputs plus a gamma slider.
- [ ] Store test: "adding adjustment inserts above selection in same parent". Manual check with the `run` skill on a photo (each adjustment, undo, export PNG). Commit with `feat(editor): adjustments and filters panel`.

### Task P5.4: Import adjustments and artboards

**Files:**
- Create: `src/lib/importers/psdAdjust.ts` (`psdAdjustmentToModel(a: AdjustmentLayer): Adjustment | null` and `modelAdjustmentToPsd(a: Adjustment): AdjustmentLayer`)
- Modify: `src/lib/importers/psdConvert.ts` (an adjustment layer → node `kind: "adjustment"` with the layer mask as a grayscale PNG raster mask; box = its page's full size)
- Modify: `src/lib/importers/psd.ts` (artboards: when any top-level layer has `artboard`, each artboard group becomes a page. Content is translated by `-rect.left/top`; the page background comes from `artboard.color` when `backgroundType` is set to colour, else white. Each page gets `width`/`height` from its own `artboard.rect` (× the `fitDesignSize` scale); the design size is the first artboard's. Layers outside any artboard go to an extra page "Outside artboards" at the document size)
- Modify: `src/lib/model.ts` (`Page` gains `width: z.number().positive().optional()` and `height: z.number().positive().optional()`; add `pageSize(design, page)` returning the page's size or the design's)
- Modify: every reader of the design size for a page to use `pageSize`: `src/lib/render.ts` (`renderPageCanvas`, thumbnails), `src/components/editor/Canvas.tsx` (stage/page rect, fit-to-screen, snapping and `alignToPage`), and the exporters (`src/lib/importers/psdExport.ts`, PNG/PDF export). Enumerate the sites with `grep -rn "design.width\|design.height" src`.
- Test: `tests/import/psd-adjust.test.ts`
- [ ] Tests: "levels maps each channel", "curves points 0..255 → 0..1", "hue/sat master and ranges", "gradient map stops", "selective color dropped with note", "two artboards become two pages with translated content", "artboards of different sizes keep per-page width/height", "page without width/height renders at design size", "workfile keeps page size", "adjustment mask becomes rasterMask asset". FAIL, implement, PASS. Commit with `feat(import): psd adjustment layers and artboards`.

**P5 risks:** `getImageData` on the editor's scene canvas every redraw with full-page adjustments is the main performance risk. Mitigations: a full-page adjustment reads only the visible stage area. While dragging, Konva redraws the layer, so adjustments recompute each frame; if a profile shows > 16 ms, cache the "below" composite per adjustment keyed on a page version counter, and skip recompute while the dragged element is above the adjustment. Safari canvas readback is slow; test on Safari. Formula fidelity vs Photoshop is approximate: document that, and keep the composite reference layer for comparison.

### P4d notes (rich text, rotated text, smart objects; implemented 2026-10-26; these win over the P4 text above)

Scope: P4.6, the text and smart-object halves of P4.5, and text runs in P6a's export. Not done: select-a-word restyling (user decision: future), the textarea shows the box's base style while editing (the canvas shows runs again on commit), smart objects are still exported as pixel layers.

- **Model** (no version bump; version 3 is unreleased). `TextRun` (`length` + optional `fontFamily`, `fontSize`, `bold`, `italic`, `underline`, `strike`, `fill`, `letterSpacing`, `baselineShift` (up, design units), `caps: "all" | "small"`, `scaleX`, `scaleY`) and `ParagraphRun` (`length` + optional `align`, `indent` (first line), `startIndent`, `endIndent`, `spaceBefore`, `spaceAfter`); `TextElement.runs?`/`paragraphs?` (≤ 2000 each). Lengths are UTF-16 units over the text; a paragraph takes the paragraph run covering its first character. Runs are overrides: a field equal to the element's own value is dropped (`normalizeRuns`), equal neighbours merge, and one run with no overrides is no runs. `ImageElement.source?: { kind: "smart-object", name }` (no `transform` field: the frame is the element's x/y/size/rotation).
- **`src/lib/richText.ts`** (pure): `remapRuns` (common prefix/suffix; inserted text takes the style of the character before it, the first run's at the start; runs that don't add up are fitted first), `remapTextRuns`, `normalizeRuns`, `applyToWholeBox` (toolbar edits set the element value and strip that field from every run; `align` strips paragraph aligns), `bumpFontSize` (± on every size), `scaleTextStyle` (corner resize scales run sizes, spacing, shifts and paragraph spacing), `hasRichStyle`, `textFamilies`, `maxFontSize`, `mixedField`, `resolvedRuns`/`resolvedParagraphs`, `layoutRichText`/`drawRichText`/`contextMeasure`. Layout mirrors Konva.Text: break after spaces and dashes, a word too long breaks by characters, wrapped lines trimmed, line height = `lineHeight` × the line's largest size (an empty line takes the size at its line break), per-paragraph align and indents, space before (not on the first paragraph) and after (not after the last). Spans are drawn with textBaseline "middle" like Konva, offset `0.36 × (line max − span size)` so baselines line up; letter spacing draws per character as Konva does; underline at middle + round(size/2) and strike at the middle, `size/15` wide; small caps = upper case at 0.7×; scales via `ctx.scale` about the span's middle.
- **Rendering.** `ownNodes` keeps `Konva.Text` for a text element without rich style (old elements are pixel-identical, test-asserted) and emits one `Shape` (`richTextAttrs`: the box's width/height, layout made on first draw with that context's metrics, box hit rect) otherwise, so effects, blend, clip stacks, vector masks, rasterize and exports all go through it unchanged. `normalize` measures the rich layout height; `basePad` uses the largest size; the fx font-state key checks every run family; `pageFonts`/`elementFonts`, workfile font packing and the font picker's "In this design" list include run families.
- **Editing.** `TextEditor` remaps runs on every change (`update` with a function patch, same coalesced undo step). Toolbar (`updText`): font, size, colour, B/I/U, align, letter spacing and line height apply to the whole box; the font picker shows "Mixed" and the size field an empty value with a "Mixed" placeholder when runs differ; typing a size sets every run to it, −/+ move every size by 1. B/I/U show active only when not mixed; clicking a mixed one turns it on everywhere. Corner resize scales runs (`Canvas` transform end); side resize re-wraps through the store (rich text has no `Text` node, the fx path already handled that).
- **PSD import** (`psdConvert.readText` + `psd.ts textElement`). Text is copied character by character with its style-run and paragraph-run index (`\r\n`, `\r`, ETX → `\n`; trailing breaks trimmed), then re-run-length-encoded, so runs always fit the cleaned text. Per run: font via `matchFont`, size × the transform's vertical scale, fill, faux bold/italic, underline, strikethrough, tracking → letter spacing, baseline shift, `fontCaps` 1/2 → small/all caps, horizontal/vertical scale, super/subscript (`fontBaseline` 1/2) → size × `superscriptSize`/`subscriptSize` (default 0.583) and a shift of ± size × position (default 0.333). The element's own values are a **per-field vote** by character count (first seen wins a tie), so a decoration on a short run doesn't become the default. Paragraph runs: justification (justify-* → their side), indents and spacing × scale; the element's align is the majority. Transforms: rotation + uniform or non-uniform scale stay editable text (`rotation = atan2(xy, xx)`; a horizontal stretch beyond the vertical becomes every run's `scaleX`); box text's top-left is the transformed `boxBounds` corner; point text puts the first baseline on the anchor in the rotated frame, using the first line's largest size, and its width is measured with its runs (`fitTextWidth` lays out rich text). Skewed or mirrored, warped, vertical and on-path text keep their pixels with a "baked" item ("Text that is skewed was kept as pixels.") and the note "Warped, skewed, vertical or on-path text came in as images." The old mixed-alignment note is gone.
- **Smart objects.** The worker reads with `skipLinkedFilesData: false` in one pass: ag-psd's `readBytes` returns *views* into the file buffer, so reading linked data costs no extra memory; only accepted originals are copied out (`Blob`), each ≤ `MAX_SMART_BYTES` (25 MB, the upload limit) and ≤ 16384 px a side, all together ≤ `MAX_SMART_TOTAL` (150 MB). `imageSniff.ts` reads PNG/JPEG/WebP type and size from the header. A layer with `placedLayer` whose linked file (by id) is such an image, with no smart filter, no warp (style none, or a custom warp whose 4×4 mesh is the identity grid, which is what writers put on an unwarped object), and a transform (`nonAffineTransform` if present) that is a rotated, scaled rectangle (parallelogram ±0.5 px, square corners, not mirrored) becomes an image element of the original file (its own mime, `generated` asset with the original's pixel size, `source.kind = "smart-object"`) in that frame, with rotation. Otherwise it uses the layer pixels as before, with a note "Some smart objects came in as their flattened pixels." plus an item: embedded PSD/AI/PDF or unknown data (info), filters (baked), warp (baked), perspective/skew (baked), too large (info). Unsupported effects (bake needs pixels) and a pixel mask also keep the pixels, silently. A vector mask on a rotated smart object is put in the element's rotated frame. Supported effects, blend, opacity and fill opacity stay as on any layer.
- **PSD export** (`psdBuild.textData`). The element's own style stays `style`; when it has runs, every run is written in full (`styleRuns`, font via `psdFont` per run, tracking, leading, strikethrough, baseline shift, `fontCaps`, horizontal/vertical scale); paragraph runs as `paragraphStyleRuns` (justification, first-line/start/end indents, space before/after). `boxBounds` height uses the largest size. Rotated text keeps its `[cos, sin, −sin, cos, x, y]` transform and now re-imports as rotated text. `writePsd` logs nothing for these fields (round-trip test).
- **Tests.** `tests/model/richText.test.ts` (28: remap insert/boundary/start/delete across/merge/replace all/empty/fitting, whole-box edits, bump, scale, schema back-compat, layout: plain height, mixed sizes, wrap across runs, long word, paragraphs, caps, scaleX, spacing/shift, empty line), `tests/render/rich-text.test.ts` (8, jsdom: old text is `Text` and pixel-identical, rich `Shape` box, single-style rich ≈ plain ±1 px, mixed sizes wider/taller with aligned baselines, wrapped height, colour runs, effects on rich text, page fonts), `tests/import/psd-text.test.ts` (11), `tests/import/psd-smart.test.ts` (11 incl. sniffing, PNG via ag-psd write/read with rotation 30°, JPEG, perspective, warp, identity warp, PDF data, filter, size cap, no data / pixel mask, rotated vector mask), `tests/export/psd-roundtrip.test.ts` (+3: runs written, runs and paragraphs round-trip, rotated rich text).
- **Browser check (dev, Chrome).** Generated `p4d-rich.psd` (box headline with five style runs (Playfair bold red, Inter bold underlined, all-caps italic tracked, strikethrough, green) and two paragraphs (centred with space after, left with first-line indent); point text rotated −15° with an orange run; a 400×200 PNG smart object placed at 200×100 rotated 20° over a flat grey stand-in): all opened as expected, the smart object sharp from its original. Typed "gest" after "Big" (kept red Playfair) and deleted the struck "Everything " (strike run gone, rest kept); toolbar showed Mixed font and size; + four times grew every size and re-wrapped/re-measured the box; Download > PSD and reopened: identical, text still editable. No console errors or warnings (only the pre-existing "form field should have an id or name" issue).
- **Deferred: needs real Photoshop file.** Whether Photoshop's `horizontalScale`/`verticalScale` are fractions (assumed, ag-psd passes them through), super/subscript defaults, how Photoshop applies space before on a box's first paragraph, smart-object corner order (TL, TR, BR, BL assumed) and whether `nonAffineTransform` is present on every distorted object.


### P5 notes (implemented 2026-10-27; these win over the P5 text above)

Scope: P5.1 to P5.4. No version bump (3 is unreleased). Not done: nothing from the P5 task list; the Safari readback check and a profile of a full-page adjustment while dragging are still open.

- **Files.** Model: `src/lib/adjustments.ts` (`Adjustment`, `Filter`, `RasterMask` with an `outside` coverage 0..1, defaults, `hasActiveFilters`, `filterReach`), `AdjustmentElement` and `Page.width/height` + `pageSize(design, page)` in `model.ts`. Pixels: `src/lib/fx/adjust.ts` (own formulas; kernels are lookup tables, a luma table or a per-pixel function, cached by the adjustment's JSON; `applyFilters` for blur, sharpen, noise and adjust), `src/lib/fx/adjustDraw.ts` (the Konva `Shape` for an adjustment element), `readback.ts` (`readBackdrop`, `writeBackBlended`). UI: `AdjustmentPanel.tsx` (Add adjustment menu in the Layers tab, the per-type editor, the Filters panel), the `ContextToolbar` row for a selected adjustment. Import: `psdAdjust.ts`, `psdConvert.ts`, `psd.ts`.
- **Rendering (P5.1/P5.2).** An adjustment element is a non-listening `Shape`. Its `sceneFunc` reads the backdrop of its device rect (clipped to the canvas) from the context it is drawn into, applies the adjustment, and writes it back with its blend mode, opacity and raster-mask coverage, so pass-through groups, isolated group caches and clip stacks give the Photoshop behaviours without extra code. The result is memoised per element (device rect, transform, mask bitmap, `fxGeneration` and a stamp), so redraws that don't change what is below do no work. The mask bitmap must have loaded: until then nothing is drawn rather than an unmasked adjustment. Filters run in the fx content stage before effects (`needsFx` is true when `filters` is set), and a page-sized raster is capped like every fx raster.
- **Import mapping (P5.4, `psdAdjust.ts`).** `psdAdjustmentToModel` / `modelAdjustmentToPsd` (the latter is for P6c). Levels: shadow/highlight input and output as is, `midtoneInput` is the gamma; channels equal to the default are dropped (files write all of them). Curves: `input`/`output` 0..255 to `x`/`y` 0..1, sorted, one point per input, thinned to 16, a single point is not a curve. Hue/Saturation: master plus only the ranges that change something, with the file's own `a b c d` edges. Colorize (final review I-1, checked against ag-psd's `hue2` reader/writer): the record is version, a colorize byte and a pad byte, the colorize hue/saturation/lightness, then the master shift; ag-psd reads those seven words as `master`, so `master.a = flag << 8 | pad` and `master.b/c/d` are the colorize hue (0..360), saturation and lightness. `(master.a & 0xff00) !== 0` imports as `colorize: true` with those values (ranges dropped: colorize ignores them), and the export writes them back the same way. Gradient map: ag-psd already divides the stored locations by the smoothness (0..1), opacity stops are 0..255 in the file; noise gradients and files with no stops return null. Photo filter colour in Lab is converted approximately. `selective color` and `color lookup` return null: the node is dropped with a note and a `dropped` issue (so `lossy` and the hidden reference layer), as before. Brightness/Contrast `legacy` follows `useLegacy`.
- **Adjustment layers (P5.4, `psdConvert.ts`).** A node `kind: "adjustment"` with `adjustment`, opacity, hidden, clipping and a mapped blend mode; its box is the whole page (`psd.ts` fills it in). The layer mask becomes `node.mask`: a PNG of the mask rectangle with the value in the colour channels **and** alpha (the renderer reads alpha), `outside` = `defaultColor / 255`. A disabled mask is ignored; a mask with no pixels and a black default hides the adjustment (`hidden`); a vector mask on an adjustment is dropped with a note. The layer's fill opacity is multiplied into its opacity (an adjustment has no effects, so the two act alike).
- **Artboards (P5.4, `psd.ts`).** `convert` marks a top-level folder with `artboard.rect` as `node.artboard` (left/top/size, `background` from `artboard.color` when `backgroundType` is 4, black for 2, else white). `artboardBuckets` makes one page per artboard in file order, moves everything in it by `-rect.left/top` (`shiftNode`: box, vector and vector-mask paths, text box and anchor, adjustment mask), takes the artboard folder away so its members sit at the page's top level, and puts layers outside every artboard on a last page at the document's size (there is no page name field, so a note says so). Each page gets its own `width`/`height` (x scale); the design size is the first artboard's. The scale is the **smallest** fit scale over all artboards (not only the first's) and, when an outside page exists, the document's own, so no page passes the 8000 px limit (or the schema's 10000) and the pages keep their proportions. When the file is lossy, the flattened reference composite is the hidden, locked bottom layer of **every** page (including the outside page), one shared asset, offset by `-artboard.left/top` (x scale) so it lines up with that artboard; one note says so. Adjustments inside an artboard cover that page. A hidden artboard folder makes its top-level members hidden (final review); its opacity, effects and issues are still not carried.
- **Page size readers.** `pageSize` is used by `render.ts`, `export.ts`, `Canvas.tsx`, `actions.ts`, `ContextToolbar.tsx`, `store/editor.ts` and `psdBuild.ts`. `grep -rn "design.width\|design.height" src` leaves only the Documents list label and `pdf.ts` (which builds a design from a PDF page and has no pages yet). `.canvasme` keeps `width`/`height` because they are in the zod `Page`.
- **Tests.** `tests/import/psd-adjust.test.ts` (17): every case named in the task, plus the other ten adjustment types in both directions, a file round trip of levels/curves/hue-sat/gradient map through `writePsd`/`readPsd`, color lookup, the mask PNG bytes, and the scale of mixed oversized artboards. Earlier: `tests/fx/adjust.test.ts`, `tests/render/adjust.test.ts` (backdrop, clip, group, mask, page sizes), `tests/model/workfile-adjust.test.ts`, `tests/export/page-size.test.ts`. `psd-structure.test.ts` now uses a selective color layer (not a brightness layer) to make the file lossy.
- **Limits.** Formulas are approximations of Photoshop's; the flattened reference composite (hidden, locked) is the comparison. Hue/Saturation range edges outside 0..360 wrap, "targeted adjustment" metadata, the Curves "auto" flag and per-channel curves beyond rgb/r/g/b are not kept. A layer style on an adjustment layer is ignored. Safari canvas readback speed is untested. Photoshop's artboard background types other than custom colour and black are drawn white.

---

# Phase 6: PSD export round-trip

**Goal:** `exportPsd` writes Photoshop-editable structure: text layers, effects, blend modes, fill opacity, groups, clipping, vector shapes and adjustment layers. A round-trip test suite proves `import(export(x)) ≈ x`.

### Task P6a: Export effects, blend, fill opacity and editable text (after P3)

**Files:**
- Create: `src/lib/importers/psdBuild.ts`
- Modify: `src/lib/importers/psdExport.ts` (becomes: render the composite, `buildPsd(design, page, renderLayer)`, `writePsd`, download)
- Test: `tests/export/psd-roundtrip.test.ts` (jsdom)

**Interfaces:**
- Produces: `buildPsd(design: Design, page: Page, renderLayer: (el: Element, o: { effects: false }) => Promise<{ canvas: HTMLCanvasElement; box: Box } | null>): Promise<Psd>`.
- Per-element layer:
  - `blendMode: BLEND_TO_PSD[el.blendMode ?? "normal"]`, `opacity`, `fillOpacity`, `effects: modelEffectsToPsd(el.effects)` (every effect written with explicit `enabled`; active ones `enabled: true`), `hidden`.
  - The pixels come from `renderElementLayer(design, el, 1, { effects: false })`, because Photoshop renders effects itself and must not get them doubled.
  - **Text** elements also get `text: LayerTextData` = { `text`, `transform: [1,0,0,1,x,baselineY]` (rotation → `[cos,sin,−sin,cos,…]`), `shapeType: "box"`, `boxBounds: [0,0,width,height]`, `style` { `font.name` (family; bold/italic → `fauxBold`/`fauxItalic` unless the font has a matching face), `fontSize`, `fillColor`, `tracking = letterSpacing/fontSize·1000`, `autoLeading: false`, `leading = lineHeight·fontSize`, `underline` }, `styleRuns` from `runs` (P4), `paragraphStyle.justification` }. Also pass `invalidateTextLayers: true` to `writePsd`, so Photoshop re-lays out the text with real fonts, while our raster stays as the preview.
  - The global light angle (`imageResources.globalAngle`) is set to 120. Effects are written with `useGlobalLight: false` and an explicit angle.
- [ ] Tests (each one builds a design, runs `buildPsd` with a stub renderer that returns a 1×1 canvas, then `writePsd` → `readFixture` → `convert` → `buildDesignFromPsdResult`, and compares):
  - "effects round-trip": every supported kind; deep-equal with 1e-2 tolerance on numbers (choke/spread quantize to whole percent).
  - "blend modes round-trip for all 27 non-group modes".
  - "fill opacity round-trip".
  - "text round-trip keeps text, size, colour, alignment, letter spacing ±0.5, line height ±0.02".
  - "hidden and opacity round-trip".
- [ ] FAIL, implement, PASS. Manual check: open the exported file in Photoshop or Photopea, **if the user has one**. Otherwise rely on the ag-psd re-read. Commit with `feat(export): psd with editable effects, blend modes and text`.

### P6a notes (implemented 2026-10-26; these win over the P6a text above)

- **Files.** `src/lib/importers/psdBuild.ts` (pure `buildPsd(design, page, renderLayer)`, `RenderLayer`, `psdFont`, `textData`, `layerName`); `psdExport.ts` is now a thin wrapper: `buildPsd` with `renderElementLayer(design, el, 1, { effects: false })`, then the composite from `renderPageCanvas`, then `writePsd(..., { generateThumbnail, noBackground, invalidateTextLayers: true })`. `psdEffects.ts` now exports `rgbOf`; effects and blend modes go through the P3 `modelEffectsToPsd`/`BLEND_TO_PSD` (no second mapping). The Download menu's PSD hint now says "with editable text and layer styles".
- **Layers.** `blendMode`, `fillOpacity` and `effects` are written only when the element uses them, so a plain element's layer has exactly the same keys as before (`name, opacity, hidden, left, top, canvas`). `pass-through` on a leaf is written as normal. Software-only modes (linear burn, vivid light, dissolve, ...) are written under their PSD names. `imageResources.globalAngle = 120` (with altitude 30); effects carry `useGlobalLight: false` and their own angle. The Background layer is built from raw `imageData`, so `buildPsd` needs no DOM (an `#rrggbbaa` page background keeps its alpha). Groups are still "Group" folders (P6b).
- **Text** is written as **box** (paragraph) text: `transform [cos, sin, -sin, cos, x, y]`, `boxBounds [0, 0, width, max(height, fontSize·lineHeight)]`, so the importer reads x/y/width back exactly, not through the baseline estimate. The font is a PostScript-style name `FamilyNoSpaces-Bold|Italic|BoldItalic|Regular` for the nearest face the family really has (from the `FONTS` spec/faces), with `fauxBold`/`fauxItalic` for whatever that face lacks (Bebas Neue bold → `BebasNeue-Regular` + faux bold). Uploaded fonts are treated as having only a regular face. Line breaks are written as `\r`. The layer also carries our rendered pixels, so readers that don't lay out text still show it.
- **Tests:** `tests/export/psd-roundtrip.test.ts` (7 cases): every effect kind incl. two drop shadows (one disabled with a contour), two strokes (colour and radial gradient), two colour overlays and a gradient overlay with midpoints, opacity stops, scale, reverse and offset, deep-equal within 1e-2; all 26 non-normal leaf blend modes (pass-through on a leaf reads back as normal); opacity vs fill opacity, and hidden; pixels requested with `effects: false`; text stays editable text (font, bold/italic/underline, colour, alignment, size, letter spacing ±0.5, line height ±0.02, box) with its effects; a plain element's layer keys are unchanged; groups stay folders. `writePsd` runs with `logMissingFeatures: true` and the test fails on any console output.
- **Browser check (dev, Chrome).** A `.canvasme` with a rect (fill 60%, drop shadow, stroke, soft-light gradient overlay), a linear-burn star with outer glow and Playfair Display bold text with a shadow and stroke → Download > PSD → reopened through Open file: it looks the same; the rect and star come back as images with their editable effects, blend and fill, and the headline comes back as editable text (font, 48 px, bold, centred) with Drop shadow and Stroke on in the Effects panel. No console errors (only the known P1 `willReadFrequently` warning).
- **Limits (deferred: needs Photoshop).** Not checked in real Photoshop. Photoshop re-lays out text with its own fonts (`invalidateTextLayers`), so line breaks and the first baseline may shift a little (box text puts the first baseline at the top plus the ascent; our Konva layout centres it in the line box), and a missing font gets substituted there. Rotated text is written rotated, but our own importer still reads rotated text as an image. Shapes, lines and paths are pixel layers with live layer styles (vector export is P6b). Our effects are approximations of Photoshop's (blur sigma, glow falloff, interior compositing), so Photoshop's own rendering of the same styles can differ slightly. Software blend modes and multi-effect order rely on Photoshop's handling (multi-effect order is the P3 deferred item).

### Task P6b: Export groups, clipping, vectors and vector masks (after P4)

**Files:** Modify `src/lib/importers/psdBuild.ts`. Test: extend `tests/export/psd-roundtrip.test.ts`.
- Groups → `children` folders (recursively from `buildRenderTree`) with `opacity`, `blendMode` (`pass-through` → `"pass through"`), `effects`, `hidden` and `opened: !collapsed`. `clipped` → `clipping: true`.
- Vector elements → `vectorMask: { paths }` (knots back to document px with the `[inX,inY,x,y,outX,outY]` order) + `vectorFill` from fill Paint + `vectorStroke` + raster pixels (no effects). Shape elements (rect, ellipse, polygon) are exported as vectors via `shapeToVector`. Image `mask` (clip-to-shape) → a pixel layer of the masked render plus `vectorMask` from the mask shape.
- `vectorMask` on any element → `vectorMask`.

### P6b notes (implemented 2026-10-27; these win over the P6b text above)

- **Files.** `src/lib/importers/psdBuild.ts` (`treeLayers`/`groupLayer` folders from `buildRenderTree(tidyTree(...))`, `vectorLayer`, `toDocument`, `pixelsOnly`), `src/lib/shapes.ts` (new `shapeSubpaths`, `shapeToVector`, `maskToVectorMask`), reusing `subpathsToPsdPaths`/`paintToPsd` in `psdVector.ts` (the inverse of the import mapping, no second knot mapping). Tests: `tests/export/psd-roundtrip.test.ts` (groups, clipping, vectors, vector masks, shapes, masked images).
- **Groups** are folders with `opened: !collapsed`, opacity, hidden, effects, `clipping` and `blendMode` (`pass-through` or none -> `"pass through"`). **Clipped** layers and groups get `clipping: true`.
- **Vectors** are shape layers: `vectorMask.paths` in document px (rotation and position applied), `vectorFill`, `vectorStroke` and pixels without the stroke (Photoshop draws it) or effects. Even-odd is written as non-zero with exclude operations. No `vectorOrigination`: layers open as paths with fill.
- **Shapes** (rect incl. rounded, ellipse, triangle, hexagon, star) export as vectors via `shapeToVector` (rounded corners and ellipses as four-curve circles, kappa 0.5523); reimport reads vectors, not live shapes. Line joins match what the editor draws (`render.ts`): rect and ellipse mitre (Konva's default), triangle, hexagon and star join round (final review I-5).
- **Shape layer or pixels (`liveVector`).** A PSD layer has one vector-mask slot and Photoshop ignores a shape layer's pixels, so a vector or shape is written as a shape layer only when that is exact. With its own `vectorMask`, with filters, or with a translucent solid fill plus a stroke **or any active effect**, it stays a pixel layer (stroke included in the pixels, effects live); its own `vectorMask` is then written live and left out of the pixels. The effects case (final review I-2): our effects follow the content's alpha, Photoshop's follow the opaque shape, so a translucent card's shadow would come out stronger; as pixels the look is exact. A translucent solid fill with no stroke and no active effect stays a shape layer and the fill colour's alpha is multiplied into `fillOpacity`; it reimports as the opaque colour with that `fillOpacity` (same effective fill). A stroke colour's alpha is the stroke's opacity.
- **Image `mask`** (clip to shape): a pixel layer of the masked render plus `vectorMask` from the mask shape in the image's local units (the pixels are already masked, so the edge is anti-aliased twice). An image's own `vectorMask` wins if it has both.
- **Adjustments** are still skipped with a note (P6c).
- **Limits (deferred: needs Photoshop).** Not opened in real Photoshop. Knot order, path operations and `fillRule` flags are verified by round-trip through ag-psd only.
- [ ] Tests: "nested groups round-trip with opacity and blend", "clipping round-trip", "vector knots round-trip ±0.01px", "shape exports as vector and reimports as vector", "vector mask round-trip". Then implement and commit with `feat(export): psd groups, clipping and vector layers`.

### Task P6c: Export adjustments and artboards (after P5)

**Files:** Modify `src/lib/importers/psdBuild.ts` and `psdExport.ts` (an option on the existing export dialog: "All pages as artboards" vs "Current page").
- Adjustment elements → layers with `adjustment: modelAdjustmentToPsd(...)` and the `rasterMask` as `mask.imageData`.
- Filters on elements have no PSD equivalent outside smart objects, so they are baked into that layer's pixels (render with filters on and effects off) and listed in an export note toast.
- Artboards: each page becomes a top-level group with `artboard.rect` sized from `pageSize(design, page)`, laid out horizontally with 100 px gaps. The PSD document is wide enough for the row and as tall as the tallest page. "Current page" exports at that page's own size.
- [ ] Tests: "adjustments round-trip (each type)", "pages export as artboards and reimport as pages", "mixed page sizes round-trip per artboard", "filters baked and noted". Then implement and commit with `feat(export): psd adjustment layers and artboards`.

### P6c notes (implemented 2026-10-27; these win over the P6c text above)

- **Files.** `src/lib/importers/psdBuild.ts` (`adjustmentLayer`, `pageLayers`, `shiftLayer`, `buildArtboardPsd`, `BuildIo`, `ARTBOARD_GAP`), `psdExport.ts` (`exportPsd(design, pageId, mode)`, mask loader), `TopBar.tsx`. Tests added to `tests/export/psd-roundtrip.test.ts` (9 cases); `page-size.test.ts` updated (adjustments are now layers).
- **Adjustments.** An adjustment element is a layer with `adjustment: modelAdjustmentToPsd(...)`, no pixels, opacity, hidden, clipping and blend mode; it works inside groups. Its `rasterMask` becomes `mask` (`imageData` red channel, which `psdExport`'s loader fills from the mask image's alpha, the value the renderer reads, not from the premultiplied red; `left/top/right/bottom` from x/y/width/height rounded, `defaultColor = round(outside*255)`). The pure builder gets the pixels through `BuildIo.loadMask(assetId, w, h)`; `psdExport` loads the asset, and draws it at w x h. A mask that can't be read is left out with a note. Effects and fill opacity on an adjustment are not written. Colorize is written exactly (`master.a = 256`, `b/c/d` = hue/saturation/lightness; see the P5 notes), with no note.
- **Filters** were already baked (render with filters, effects off) with one deduplicated note; no change besides `addNote` deduping across pages. Hidden elements don't raise the note.
- **Artboards.** `buildArtboardPsd(design, pages, ...)`: each page is a top-level "Artboard N" folder (pass through, opened) with `artboard.rect` from `pageSize`, the page background as `artboard.color` (`backgroundType: 4`, alpha dropped), placed by `artboardLayout` (final review I-3): a grid in reading order with 100 px gaps between pages and rows, each row as tall as its tallest page; one row when it fits, otherwise the fewest rows (same count per row, the last may be short) whose document stays within 30,000 px a side (`ARTBOARD_MAX_SIDE`, Photoshop's PSD limit) and 50,000,000 px (`ARTBOARD_MAX_PIXELS`: ag-psd allocates ~12 bytes per document pixel even without a composite), and of those the smallest. When no grid fits, `buildArtboardPsd` throws `ARTBOARDS_TOO_BIG` ("Too many or too large pages to export as artboards — export the current page instead.") before rendering or allocating; TopBar's `run` shows it as the notice. The importer maps every artboard by its rect and keeps file order, which is reading order, so a grid reimports as the same pages in the same order. Document-level `artboards: { count }`. There is no Background layer in this mode. Layers are built in page coordinates and moved by `shiftLayer` (pixels, text transform, vector-mask knots, layer mask). The composite is each `renderPageCanvas` drawn at its artboard rect (gaps transparent). A one-page design exported as artboards is written as the current page (commented in `exportPsd`). The importer reads this back as one page per artboard at its own size, with no extra page.
- **UI.** Download menu: "PSD: this page" (unchanged, writes the current page at its own size) plus, only when the design has 2+ pages, "PSD: all pages as artboards". Same item style as the others, so it fits at 390 px.
- **Fix round 1.** (a) The artboard composite must equal the document size, so it is never scaled: when the document is over the raster caps (`compositeFits`: 4096 px a side, 16,000,000 px) it is left out (`psd.canvas` unset, no thumbnail), layers are still written at full size, and a note says "The file is very large, so its preview image was left blank: Photoshop rebuilds it on open, but other apps may show it black." (ag-psd still writes a composite section, all black.) A refused 2D context throws a clear Error. (b) The colorize workaround of this round (wrapped hue plus a note) was replaced in the final review by the exact mapping above.
- **Final review fixes.** "Current page" export is back to the pre-P6c behaviour (I-4): the page is always rendered as the composite and the thumbnail is generated, whatever its size; a canvas with no 2D context throws the same clear Error. Tests added to `psd-roundtrip.test.ts`: colorize bytes in the `hue2` record and the round trip, a translucent fill with an active effect as pixels, polygon line joins, the filters note skipping hidden elements, grid wrap of 30 pages, the layout rules, the 50 M px refusal (nothing rendered), and an adjustment mask moving with its artboard; in `psd-adjust.test.ts`: colorize import, adjustment fill opacity, a hidden artboard.
- **Limits.** Not opened in real Photoshop. Page names are not kept (no name on pages): artboards are "Artboard N". Layers keep 1x (no export scale).

**P6 risks:** ag-psd's text writing support for some fields (check `writePsd` with `logMissingFeatures: true` in tests and fail on any warning about fields we set). Photoshop may reject a malformed `vectorOrigination`, so don't write it (shape layers then open as "paths with fill", which is acceptable). Round-trip equality hides Photoshop-specific behaviour; flag the manual Photoshop check in the PR description.

---

## Verification commands (every task)

```bash
npm run typecheck   # tsc --noEmit, 0 errors
npm test            # vitest run, all pass
npm run lint        # eslint, 0 errors
npm run build       # each phase's last task: static export must build (next build + sw)
```

UI tasks also get a manual pass with the `run` skill (dev server at `/app`), checking at desktop width and at a 390 px phone width.

## Key decisions recorded in this plan

1. **Live software blending** for the 10 blend modes the canvas lacks, via backdrop readback and `writeBackBlended`, instead of baking. This keeps every PSD blend mode editable, at a performance cost on large elements.
2. **Our own pixel pipeline** (Float32, pure TS) for effects, bakes, adjustments and filters. It's identical across browsers and exports, and testable in Node. Native canvas `shadowBlur` and `ctx.filter` are not used (they differ across engines, and Safari's `ctx.filter` support is incomplete).
3. **Effect sizes stay constant when an element is resized** (they don't scale with the box), the same as Photoshop without "Scale Styles".
4. **Groups are elements in the flat array**, with `groupId` as the parent pointer, and selection still acts on leaves. This is the smallest change to the store, canvas and transformer.
5. **Bevel, satin and pattern bakes are our own approximations.** ag-psd has no effect renderer, and the Photoshop composite can't be split per layer.
6. **Format version bumps** (2 in P1, 3 in P4) with a migration module, so newer files never silently lose data in older builds.
