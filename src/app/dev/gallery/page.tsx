import { notFound } from "next/navigation";
import Gallery from "./gallery";

export const dynamic = "force-dynamic";

export default function GalleryPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <Gallery />;
}
