import type { Metadata } from "next";
import { ThemeScope } from "@/components/ThemeScope";
import { THEME_INIT_SCRIPT } from "@/lib/themeScript";

export const metadata: Metadata = {
  title: "Your designs",
  description: "Start a new design from a size, or open one saved in this browser. Free, no sign-up.",
  alternates: { canonical: "/app" },
};

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      <ThemeScope />
      {children}
    </>
  );
}
