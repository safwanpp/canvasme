"use client";

import { create } from "zustand";

export type PdfMode = "image" | "text";

/** A note about what an import could not bring over, shown once the new design opens. */
export type ImportReport = { title: string; notes: string[]; designId?: string };

type JobState = {
  /** Shown while a file is being converted. */
  progress: { label: string; detail?: string } | null;
  /** Waiting on the user to pick how an .ai/.pdf file comes in. */
  ask: { fileName: string; answer: (mode: PdfMode | null) => void } | null;
  report: ImportReport | null;
};

export const useImportJob = create<JobState>(() => ({ progress: null, ask: null, report: null }));

export const setProgress = (label: string, detail?: string) =>
  useImportJob.setState({ progress: { label, detail } });

export const clearProgress = () => useImportJob.setState({ progress: null });

export const setReport = (report: ImportReport | null) => useImportJob.setState({ report });

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
