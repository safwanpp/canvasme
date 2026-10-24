import type { MetadataRoute } from "next";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "canvas.me: free design editor",
    short_name: "canvas.me",
    description: "Design posts, slides and posters without an account. Your designs stay on your device.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#f3f4f7",
    theme_color: "#f3f4f7",
    categories: ["design", "graphics", "productivity"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    screenshots: [
      {
        src: "/screens/editor-desktop.webp",
        sizes: "2880x1800",
        type: "image/webp",
        form_factor: "wide",
        label: "The canvas.me editor on a laptop",
      },
      {
        src: "/screens/editor-mobile.webp",
        sizes: "1170x2532",
        type: "image/webp",
        form_factor: "narrow",
        label: "The canvas.me editor on a phone",
      },
    ],
    shortcuts: [
      { name: "New Instagram post", url: "/app?size=1080x1080&name=Instagram%20post" },
      { name: "New story", url: "/app?size=1080x1920&name=Story" },
      { name: "New presentation", url: "/app?size=1920x1080&name=Presentation" },
    ],
    // Chromium desktop: double-click a .canvasme file to open it in the installed app.
    file_handlers: [{ action: "/app", accept: { "application/x-canvasme": [".canvasme"] } }],
  } as MetadataRoute.Manifest;
}
