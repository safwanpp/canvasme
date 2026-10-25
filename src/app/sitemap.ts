import type { MetadataRoute } from "next";
import { SITE } from "@/lib/site";

export const dynamic = "force-static";

const PAGES: { path: string; priority: number }[] = [
  { path: "/", priority: 1 },
  { path: "/features", priority: 0.8 },
  { path: "/malayalam-poster-maker", priority: 0.8 },
  { path: "/remove-background", priority: 0.8 },
  { path: "/app", priority: 0.6 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(({ path, priority }) => ({
    url: `${SITE.url}${path === "/" ? "/" : path}`,
    lastModified: SITE.updated,
    changeFrequency: "monthly",
    priority,
  }));
}
