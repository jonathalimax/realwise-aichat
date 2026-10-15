"use client";

import { createContext, useContext } from "react";

export type LiveKey = "orders" | "prescriptions" | "handoffs" | "conversations" | "clients" | "overview";
/** Opaque change marker per list; a page refetches only when ITS marker changes. */
export type LiveMarkers = Partial<Record<LiveKey, string>>;

export const LiveContext = createContext<{ markers: LiveMarkers; ready: boolean } | null>(null);

/** Joined marker of the given keys, or null when live refresh is not running (public pages, non-pharmacy, no permission). */
export function useLiveMarker(keys?: LiveKey | LiveKey[]): string | null {
  const ctx = useContext(LiveContext);
  if (!ctx || !ctx.ready || !keys) return null;
  const list = Array.isArray(keys) ? keys : [keys];
  const parts = list.map((k) => ctx.markers[k]).filter((x): x is string => typeof x === "string");
  return parts.length ? parts.join("|") : null;
}
