"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { dismissAlert, getAlerts, type BusinessAlert } from "../../lib/pharmacy-api";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { modeOf } from "../../lib/nav";
import { useSession } from "../../lib/session";
import { useLiveMarker } from "../../lib/live-context";

const POLL_MS = 60_000;

/** Active business alerts (BusinessAlert rows: new order waiting, urgent handoff, stale sheet...) above the page. */
export function AlertsStrip() {
  const [alerts, setAlerts] = useState<BusinessAlert[]>([]);
  const [expanded, setExpanded] = useState(false);
  // Attendance mode: alerts about orders, prescriptions and stock sheets (older ones may still be active) are hidden.
  const attendance = modeOf(useSession().me) === "attendance";

  const denied = useRef(false);
  const load = useCallback(async () => {
    if (denied.current) return;
    try {
      const list = await getAlerts();
      const rank = { critical: 0, warning: 1, info: 2 } as Record<string, number>;
      // Critical first (an urgent handoff must never be pushed out by older warnings), then newest first.
      const sorted = list
        .filter((a) => a.type.startsWith("pharmacy_") && !(attendance && /order|rx|prescription|stock|sheet/i.test(a.type)))
        .sort((a, b) => (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) || String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
      // The same alert fired twice (same type and text) is shown once.
      const seen = new Set<string>();
      setAlerts(sorted.filter((a) => (seen.has(`${a.type}|${a.message}`) ? false : (seen.add(`${a.type}|${a.message}`), true))).slice(0, 8));
    } catch (e) {
      // Roles without access to alerts (courier) get a 403: stop asking instead of polling a forbidden route.
      if ((e as { status?: number })?.status === 403) denied.current = true;
      setAlerts([]);
    }
  }, [attendance]);

  const liveMarker = useLiveMarker(["overview"]);
  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load, liveMarker]);

  if (alerts.length === 0) return null;
  // Two alerts at a time keep the page usable; the rest sit behind a toggle.
  const visible = expanded ? alerts : alerts.slice(0, 2);
  const hidden = alerts.length - visible.length;
  return (
    <div className="mb-4 flex flex-col gap-1.5" aria-live="polite">
      {visible.map((a) => (
        <div
          key={a.id}
          role="status"
          className={cn(
            "flex items-center gap-2 rounded-lg border py-1 pl-3 pr-1 text-[13px]",
            a.severity === "critical" ? "border-red-200 bg-red-50 text-red-900" : a.severity === "warning" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-accent/30 bg-brand-soft text-brand-2",
          )}
        >
          <span className="min-w-0 flex-1 max-md:line-clamp-2 md:truncate" title={a.message}>
            {a.message}
          </span>
          {a.actionHref && (
            <Link href={a.actionHref} className="inline-flex shrink-0 items-center rounded-md px-2 py-1 text-[13px] font-semibold underline-offset-2 hover:underline max-md:min-h-11">
              {a.actionLabel ?? "Abrir"}
            </Link>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 max-md:h-11 max-md:w-11"
            aria-label="Dispensar aviso"
            onClick={async () => {
              setAlerts((prev) => prev.filter((x) => x.id !== a.id));
              await dismissAlert(a.id).catch(() => {});
            }}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}
      {(hidden > 0 || expanded) && alerts.length > 2 && (
        <Button variant="ghost" size="sm" className="h-6 self-start px-1 text-xs text-muted max-md:h-11" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Mostrar menos avisos" : `Ver mais ${hidden} ${hidden === 1 ? "aviso" : "avisos"}`}
        </Button>
      )}
    </div>
  );
}
