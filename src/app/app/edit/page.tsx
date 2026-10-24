"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const loading = () => <div className="flex h-dvh items-center justify-center text-sm text-ink-500">Loading editor…</div>;

// Konva needs the browser; never render the editor on the server.
const Editor = dynamic(() => import("@/components/editor/Editor"), { ssr: false, loading });

// The design id is a query param (/app/edit?id=…) so the site can be a static export.
function EditorRoute() {
  const id = useSearchParams().get("id");
  if (!id) {
    if (typeof window !== "undefined") window.location.replace("/app");
    return null;
  }
  return <Editor id={id} />;
}

export default function EditorPage() {
  return (
    <Suspense fallback={loading()}>
      <EditorRoute />
    </Suspense>
  );
}
