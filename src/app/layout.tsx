import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://canvasme.setitup.in"),
  title: "canvas.me: free design editor in your browser",
  description:
    "Design social posts, presentations and posters in your browser. No sign-up, no account. Your designs stay on your device.",
};

export const viewport: Viewport = { themeColor: "#f3f4f7" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geist.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
