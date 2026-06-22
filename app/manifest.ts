import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Crest",
    short_name: "Crest",
    description: "Zero-based budgeting",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0d946e",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
