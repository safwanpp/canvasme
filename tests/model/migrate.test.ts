// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { CURRENT_VERSION, migrateDesign } from "@/lib/migrate";
import { Design, type Element } from "@/lib/model";
import { renderPageCanvas } from "@/lib/render";
import { groupEl, makeDesign, rectEl } from "../fixtures/design";

vi.mock("@/lib/images", () => ({ loadAssetImage: async () => null, getReadyImage: () => undefined }));
vi.mock("@/lib/fonts", () => ({ ensureFonts: async () => {} }));

const els = (d: unknown) => (d as Design).pages[0].elements;

describe("migrateDesign", () => {
  it("stamps version and is idempotent", () => {
    const v1 = makeDesign([rectEl()]);
    const once = migrateDesign(v1) as Design;
    expect(once.version).toBe(3);
    expect(CURRENT_VERSION).toBe(3);
    expect(migrateDesign(migrateDesign(v1))).toEqual(once);
  });

  it("does not mutate its input and passes non-objects through", () => {
    const v1 = makeDesign([rectEl({ groupId: "g" }), rectEl({ groupId: "g" })]);
    const before = structuredClone(v1);
    migrateDesign(v1);
    expect(v1).toEqual(before);
    expect(migrateDesign(null)).toBe(null);
  });

  it("migrated design still parses", () => {
    expect(Design.safeParse(migrateDesign(makeDesign([rectEl()]))).success).toBe(true);
  });

  it("v1 design migrates with groups and renders unchanged", async () => {
    const a = rectEl({ x: 10, y: 10, width: 40, height: 40, fill: "#ff0000", groupId: "g1", opacity: 0.5 });
    const b = rectEl({ x: 30, y: 30, width: 40, height: 40, fill: "#00ff00", groupId: "g1", opacity: 0.5 });
    const c = rectEl({ x: 100, y: 100, width: 40, height: 40, fill: "#0000ff" });
    const v1 = makeDesign([a, b, c]);
    const before = await renderPageCanvas(v1, v1.pages[0], 1);
    const out = migrateDesign(v1) as Design;
    const list = els(out);
    expect(list.map((e) => e.id)).toEqual([a.id, b.id, "g1", c.id]);
    expect(list[2]).toMatchObject({ type: "group", groupId: null, x: 10, y: 10, width: 60, height: 60 });
    expect(Design.safeParse(out).success).toBe(true);
    const after = await renderPageCanvas(out, out.pages[0], 1);
    const px = (cv: HTMLCanvasElement) => Array.from(cv.getContext("2d")!.getImageData(0, 0, cv.width, cv.height).data);
    expect(px(after)).toEqual(px(before));
  });

  it("v2 members become contiguous below the group, in their order", () => {
    const v2 = { ...makeDesign([rectEl({ id: "a", groupId: "g" }), rectEl({ id: "x" }), rectEl({ id: "b", groupId: "g" })]), version: 2 };
    expect(els(migrateDesign(v2)).map((e: Element) => e.id)).toEqual(["x", "a", "b", "g"]);
  });

  it("a group of one is dissolved, and missing groupId reads as none", () => {
    const one = rectEl({ id: "a", groupId: "solo" });
    const bare = rectEl({ id: "b" }) as Partial<Element>;
    delete bare.groupId;
    const out = els(migrateDesign(makeDesign([one, bare as Element])));
    expect(out.map((e) => e.id)).toEqual(["a", "b"]);
    expect(out[0].groupId).toBeNull();
  });

  it("a v3 design with group elements is left alone", () => {
    const v3 = { ...makeDesign([rectEl({ id: "a", groupId: "G" }), rectEl({ id: "b", groupId: "G" }), groupEl({ id: "G" })]), version: 3 };
    expect(migrateDesign(v3)).toBe(v3);
  });
});

describe("newDesign", () => {
  it("stamps the current format version", async () => {
    const { newDesign, FORMAT_VERSION } = await import("@/lib/model");
    expect(newDesign("x", 10, 10).version).toBe(FORMAT_VERSION);
  });
});

