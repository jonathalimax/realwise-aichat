"use client";

import { useEffect } from "react";

// After a deploy, a browser tab that's still on the previous build can request a JS chunk by its
// old content hash -- that file no longer exists on the server (each deploy only ships the new
// build's chunks), so the fetch 404s and webpack throws ChunkLoadError. Next.js doesn't recover
// from this on its own; left alone, the app just stays broken until the visitor manually
// refreshes. Reload once (sessionStorage guard so a persistent/different error can't reload-loop
// the page forever) so this self-heals instead of looking like an outage.
const RELOAD_FLAG = "rw-chunk-reload";

export function ChunkErrorReload() {
  useEffect(() => {
    function isChunkLoadError(error: unknown): boolean {
      if (!error || typeof error !== "object") return false;
      const err = error as { name?: string; message?: string };
      return err.name === "ChunkLoadError" || /Loading chunk [\w-]+ failed/.test(err.message ?? "");
    }

    function handleError(event: ErrorEvent) {
      if (!isChunkLoadError(event.error)) return;
      reloadOnce();
    }

    function handleRejection(event: PromiseRejectionEvent) {
      if (!isChunkLoadError(event.reason)) return;
      reloadOnce();
    }

    function reloadOnce() {
      if (sessionStorage.getItem(RELOAD_FLAG)) return;
      sessionStorage.setItem(RELOAD_FLAG, "1");
      window.location.reload();
    }

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);
    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return null;
}
