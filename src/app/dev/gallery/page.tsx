import { notFound } from "next/navigation";
import Gallery from "./gallery";
import { galleryEnabled } from "@/server/lib/environment";

export const dynamic = "force-dynamic";

export default function GalleryPage() {
  if (!galleryEnabled()) notFound();
  return <Gallery />;
}
