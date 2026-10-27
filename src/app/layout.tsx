import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { PwaRegister } from "@/components/Pwa";
import { SITE } from "@/lib/site";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: { default: "canvas.me: free design editor in your browser", template: "%s · canvas.me" },
  description: SITE.description,
  applicationName: SITE.name,
  creator: SITE.maker.name,
  publisher: SITE.maker.name,
  openGraph: {
    type: "website",
    url: "/",
    siteName: SITE.name,
    locale: "en",
    title: "canvas.me: free design editor in your browser",
    description: "Make posts, slides and posters without an account. Your designs stay on your device.",
  },
  appleWebApp: { capable: true, title: SITE.name, statusBarStyle: "default" },
  formatDetection: { telephone: false },
  twitter: {
    card: "summary_large_image",
    title: "canvas.me: free design editor in your browser",
    description: "Make posts, slides and posters without an account. Your designs stay on your device.",
  },
};

export const viewport: Viewport = { themeColor: "#f3f4f7" };

// Chromium fires `beforeinstallprompt` once, often before React hydrates, so catch it in <head>
// and keep it on window for InstallButton to open the native install dialog.
const captureInstallPrompt = `addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__installPrompt=e;dispatchEvent(new Event("canvasme:installable"))});addEventListener("appinstalled",function(){window.__installPrompt=null;dispatchEvent(new Event("canvasme:installable"))});`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // suppressHydrationWarning: the /app theme script sets data-theme and colorScheme on <html> before hydration.
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: captureInstallPrompt }} />
      </head>
      <body className={`${geist.variable} ${geistMono.variable} antialiased`}>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
