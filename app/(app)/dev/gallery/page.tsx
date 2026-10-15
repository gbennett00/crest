import { notFound } from "next/navigation";
import { ComponentGallery } from "@/components/dev/component-gallery";

// Dev-only: every design system component and state, in both themes.
export default function GalleryPage() {
  if (process.env.VERCEL_ENV === "production") notFound();
  return <ComponentGallery />;
}
