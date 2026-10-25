import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Your designs",
  description: "Start a new design from a size, or open one saved in this browser. Free, no sign-up.",
  alternates: { canonical: "/app" },
};

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
