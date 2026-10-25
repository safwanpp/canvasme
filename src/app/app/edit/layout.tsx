import type { Metadata } from "next";

// The editor opens a design from this browser's storage (?id=…), so there is nothing to index.
export const metadata: Metadata = {
  title: { absolute: "Editor · canvas.me" },
  robots: { index: false, follow: true },
};

export default function EditLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
