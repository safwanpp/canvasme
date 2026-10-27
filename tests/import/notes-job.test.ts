import { describe, expect, it } from "vitest";
import { closeNotes, notesShownFor, openNotes, useImportJob } from "@/lib/importers/job";

describe("import notes requests", () => {
  it("every open is a new request, even while the notes are already open", () => {
    openNotes("d1");
    const first = useImportJob.getState().notesRequest;
    openNotes("d1");
    expect(useImportJob.getState().notesRequest).toBe(first + 1);
    closeNotes();
  });

  it("notes opened for one design don't show in another", () => {
    openNotes("d1");
    expect(notesShownFor(useImportJob.getState(), "d1")).toBe(true);
    expect(notesShownFor(useImportJob.getState(), "d2")).toBe(false);
    closeNotes();
    expect(notesShownFor(useImportJob.getState(), "d1")).toBe(false);
  });
});
