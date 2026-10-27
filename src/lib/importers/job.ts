"use client";

import { create } from "zustand";

export type PdfMode = "image" | "text";

/** A note about what an import could not bring over, shown once the new design opens. */
export type ImportReport = {
  title: string;
  notes: string[];
  designId?: string;
  /** Per-layer items kept in the design's Import notes. */
  itemsCount?: number;
};

type JobState = {
  /** Shown while a file is being converted. */
  progress: { label: string; detail?: string } | null;
  /** Waiting on the user to pick how an .ai/.pdf file comes in. */
  ask: { fileName: string; answer: (mode: PdfMode | null) => void } | null;
  report: ImportReport | null;
  /**
   * The design whose Import notes panel is open (the Layers tab shows it), or null. Scoped to a
   * design so notes opened for one never stay open in the next.
   */
  notesFor: string | null;
  /** Bumped by every open, so the editor can switch to the Layers tab each time, even if already open. */
  notesRequest: number;
};

export const useImportJob = create<JobState>(() => ({ progress: null, ask: null, report: null, notesFor: null, notesRequest: 0 }));

export const setProgress = (label: string, detail?: string) =>
  useImportJob.setState({ progress: { label, detail } });

export const clearProgress = () => useImportJob.setState({ progress: null });

export const setReport = (report: ImportReport | null) => useImportJob.setState({ report });

export const openNotes = (designId: string) =>
  useImportJob.setState((s) => ({ notesFor: designId, notesRequest: s.notesRequest + 1 }));

export const closeNotes = () => useImportJob.setState({ notesFor: null });

export const notesShownFor = (s: Pick<JobState, "notesFor">, designId: string | undefined) => !!designId && s.notesFor === designId;

/** Ask how to import an .ai/.pdf file. Resolves null if the user cancels. */
export const askPdfMode = (fileName: string) =>
  new Promise<PdfMode | null>((resolve) =>
    useImportJob.setState({
      ask: {
        fileName,
        answer: (mode) => {
          useImportJob.setState({ ask: null });
          resolve(mode);
        },
      },
    }),
  );
