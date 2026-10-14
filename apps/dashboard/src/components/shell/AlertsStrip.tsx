"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { dismissAlert, getAlerts, type BusinessAlert } from "../../lib/pharmacy-api";
import { Alert } from "../ui/alert";
import { Button, buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";

const POLL_MS = 60_000;

/** Active business alerts (BusinessAlert rows: new order waiting, urgent handoff, stale sheet...) above the page. */
export function AlertsStrip() {
  const [alerts, setAlerts] = useState<BusinessAlert[]>([]);

  const load = useCallback(async () => {
    try {
      const list = await getAlerts();
      setAlerts(list.filter((a) => a.type.startsWith("pharmacy_")).slice(0, 3));
    } catch {
      setAlerts([]);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  if (alerts.length === 0) return null;
  return (
    <div className="mb-5 flex flex-col gap-2" aria-live="polite">
      {alerts.map((a) => (
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
    </div>
  );
}
