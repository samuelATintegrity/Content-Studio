"use client";

import { useEffect } from "react";
import { bootstrapLibrary } from "@/lib/libraryStore";

// Renders nothing — exists solely to fire the one-time library bootstrap
// on app mount. Reads the localStorage mirror for instant paint, then
// fetches the shared R2 manifest, then runs legacy localStorage migration
// if the server is empty. Safe to mount anywhere in the tree.
export function LibraryBootstrap() {
  useEffect(() => {
    void bootstrapLibrary();
  }, []);
  return null;
}
