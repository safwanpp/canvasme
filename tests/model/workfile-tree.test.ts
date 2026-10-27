// Node env: jsdom's Blob mangles fflate's Uint8Array (cross-realm).
import { describe, expect, it, vi } from "vitest";
import { migrateDesign } from "@/lib/migrate";
import type { Design } from "@/lib/model";
import { groupEl, makeDesign, rectEl } from "../fixtures/design";

vi.mock("@/lib/storage", () => ({
  saveDesign: async () => {},
  loadAsset: async () => undefined,
  saveAsset: async () => {},
  saveThumb: async () => {},
  listFonts: async () => [],
  saveFont: async () => {},
  deleteFont: async () => {},
}));
vi.mock("@/lib/render", () => ({ renderThumbnail: () => Promise.reject(new Error("no thumbnails in tests")) }));

describe("workfile", () => {
  it("workfile keeps tree elements", async () => {
    const { exportWorkfile, importWorkfile } = await import("@/lib/workfile");
    const design = migrateDesign(
      makeDesign([rectEl({ id: "a", groupId: "H" }), rectEl({ id: "b", groupId: "H" }), groupEl({ id: "H", groupId: "G", collapsed: true }), rectEl({ id: "c", groupId: "G" }), groupEl({ id: "G", opacity: 0.5, blendMode: "multiply" })]),
    ) as Design;
    const back = await importWorkfile(new File([await exportWorkfile(design)], "x.canvasme"));
    const list = back.pages[0].elements;
    expect(list.map((e) => [e.id, e.groupId])).toEqual([["a", "H"], ["b", "H"], ["H", "G"], ["c", "G"], ["G", null]]);
    expect(list[2]).toMatchObject({ type: "group", collapsed: true });
    expect(list[4]).toMatchObject({ opacity: 0.5, blendMode: "multiply" });
  });
});
