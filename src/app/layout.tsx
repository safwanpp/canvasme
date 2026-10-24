import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter } from "next/font/google";
import "./globals.css";

const ui = Inter({ variable: "--font-ui", subsets: ["latin"] });
const display = Bricolage_Grotesque({ variable: "--font-display-face", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://canvasme.setitup.in"),
  title: "canvas.me: free design editor in your browser",
  description:
    "Design social posts, presentations and posters in your browser. No sign-up, no account. Your designs stay on your device.",
};

export const viewport: Viewport = { themeColor: "#16181f" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${ui.variable} ${display.variable} antialiased`}>{children}</body>
    </html>
  );
}
