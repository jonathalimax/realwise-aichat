"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { dismissAlert, getAlerts, type BusinessAlert } from "../../lib/pharmacy-api";
import { Alert } from "../ui/alert";
import { Button, buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";
import { modeOf } from "../../lib/nav";
import { useSession } from "../../lib/session";

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

  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  if (alerts.length === 0) return null;
  // Two alerts at a time keep the page usable; the rest sit behind a toggle.
  const visible = expanded ? alerts : alerts.slice(0, 2);
  const hidden = alerts.length - visible.length;
  return (
    <div className="mb-5 flex flex-col gap-2" aria-live="polite">
      {visible.map((a) => (
        <Alert
          key={a.id}
          variant={a.severity === "critical" ? "red" : a.severity === "warning" ? "amber" : "soft"}
          action={
            <span className="flex items-center gap-1">
              {a.actionHref && (
                <Link href={a.actionHref} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
                  {a.actionLabel ?? "Abrir"}
                </Link>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-[30px] w-[30px]"
                aria-label="Dispensar aviso"
                onClick={async () => {
                  setAlerts((prev) => prev.filter((x) => x.id !== a.id));
                  await dismissAlert(a.id).catch(() => {});
                }}
              >
                <X className="h-4 w-4" />
              </Button>
            </span>
          }
        >
          {a.message}
        </Alert>
      ))}
      {(hidden > 0 || expanded) && alerts.length > 2 && (
        <Button variant="ghost" size="sm" className="self-start" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Mostrar menos avisos" : `Ver mais ${hidden} ${hidden === 1 ? "aviso" : "avisos"}`}
        </Button>
      )}
    </div>
  );
}
