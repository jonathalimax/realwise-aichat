"use client";

import { ReactNode } from "react";

// Lightweight CSS-only hover tooltip — matches this kit's hand-built component convention,
// no Radix dependency needed for a simple "show content on hover" case.
export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <span className="group relative inline-flex cursor-default">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-xs -translate-x-1/2 rounded-chip border border-border bg-surface p-3 text-xs text-ink opacity-0 shadow-popover transition-opacity group-hover:opacity-100">
        {content}
      </span>
    </span>
  );
}
