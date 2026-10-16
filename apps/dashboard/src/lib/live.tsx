"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, BellOff, X } from "lucide-react";
import { getLiveSnapshot, type LiveSnapshot } from "./pharmacy-api";
import { LiveContext, type LiveMarkers } from "./live-context";
import { useSession } from "./session";

const POLL_MS = 5_000;
const SOUND_KEY = "rw_live_sound";

interface Toast {
  id: number;
  text: string;
  href: string;
}

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    g.gain.value = 0.05;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.18);
    setTimeout(() => void ctx.close(), 400);
  } catch {
    // no audio: silent
  }
}

/**
 * Live refresh for the pharmacy dashboard: polls GET /notifications/live every 5 s while the tab is visible (pauses when
 * hidden, refreshes at once on focus), exposes per-list change markers (see useLoad's `live` option), refreshes the sidebar
 * badges, shows a toast for a NEW order / atendimento / receita, mirrors the pending count in the tab title and can beep.
 */
export function LiveProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const { loaded, niche, notifications, refreshNotifications } = useSession();
  const active = enabled && loaded && niche === "farmacia";
  const [markers, setMarkers] = useState<LiveMarkers>({});
  const [ready, setReady] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [sound, setSound] = useState(false);
  const soundRef = useRef(false);
  const prev = useRef<LiveSnapshot | null>(null);
  const seq = useRef(0);
  const pathname = usePathname();

  useEffect(() => {
    try {
      const on = localStorage.getItem(SOUND_KEY) === "1";
      setSound(on);
      soundRef.current = on;
    } catch {
      // storage blocked: sound stays off
    }
  }, []);
  const toggleSound = () => {
    const next = !soundRef.current;
    soundRef.current = next;
    setSound(next);
    try {
      localStorage.setItem(SOUND_KEY, next ? "1" : "0");
    } catch {
      // ignore
    }
    if (next) beep();
  };

  const push = useCallback((text: string, href: string) => {
    const id = ++seq.current;
    setToasts((t) => [...t.slice(-3), { id, text, href }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 8000);
    if (soundRef.current) beep();
  }, []);

  const poll = useCallback(async () => {
    let snap: LiveSnapshot;
    try {
      snap = await getLiveSnapshot();
    } catch {
      return; // transient failure: try again on the next tick
    }
    const before = prev.current;
    prev.current = snap;
    const next: LiveMarkers = {};
    for (const k of ["orders", "prescriptions", "handoffs", "conversations", "clients", "overview"] as const) {
      const m = snap[k]?.marker;
      if (m) next[k] = m;
    }
    setMarkers(next);
    setReady(true);
    if (!before) return; // first poll is only the baseline
    const changed = (Object.keys(next) as (keyof LiveMarkers)[]).some((k) => (before[k]?.marker ?? null) !== next[k]);
    if (changed) void refreshNotifications();
    if (snap.orders?.latest && snap.orders.latest.code !== before.orders?.latest?.code && before.orders) push(`Novo pedido ${snap.orders.latest.code}`, "/pedidos");
    if (snap.handoffs?.latest && snap.handoffs.latest.id !== before.handoffs?.latest?.id && before.handoffs) push("Novo atendimento", "/atendimento");
    if (snap.prescriptions?.latest && snap.prescriptions.latest.code !== before.prescriptions?.latest?.code && before.prescriptions) push(`Nova receita ${snap.prescriptions.latest.code}`, "/pedidos?tab=receitas");
  }, [push, refreshNotifications]);

  useEffect(() => {
    if (!active) {
      prev.current = null;
      setReady(false);
      return;
    }
    void poll();
    const tick = () => document.visibilityState === "visible" && void poll();
    const t = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, [active, poll]);

  // Tab title badge: how much is waiting for the team.
  const pending = (notifications?.orders?.new ?? 0) + (notifications?.handoffs?.open ?? 0) + (notifications?.prescriptions?.pending ?? 0);
  useEffect(() => {
    if (!active) return;
    const base = document.title.replace(/^\(\d+\)\s*/, "") || "Painel da farmácia";
    document.title = pending > 0 ? `(${pending}) ${base}` : base;
  }, [active, pending, pathname]);

  const value = useMemo(() => ({ markers, ready }), [markers, ready]);
  return (
    <LiveContext.Provider value={value}>
      {children}
      {active && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-[calc(100vw-32px)] flex-col items-end gap-2">
          <div role="status" aria-live="polite" className="flex flex-col items-end gap-2">
            {toasts.map((t) => (
              <div key={t.id} className="pointer-events-auto flex items-center gap-2 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm font-medium text-ink shadow-lg">
                <Link href={t.href} onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="hover:underline">
                  {t.text}
                </Link>
                <button type="button" aria-label="Fechar aviso" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-bg-2">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={toggleSound}
            aria-pressed={sound}
            aria-label={sound ? "Desligar som de novos avisos" : "Ligar som de novos avisos"}
            title={sound ? "Som de novos avisos: ligado" : "Som de novos avisos: desligado"}
            className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-muted shadow hover:text-ink max-md:h-11 max-md:w-11"
          >
            {sound ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          </button>
        </div>
      )}
    </LiveContext.Provider>
  );
}
