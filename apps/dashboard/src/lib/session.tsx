"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { PermissionSection } from "@realwise/shared";
import { getMe } from "./api";
import { can as canDo, type Niche } from "./nav";
import { getAuthMe, getNotificationsSummary, type Me, type NotificationsSummary } from "./pharmacy-api";

interface SessionValue {
  /** Member payload from GET /auth/me. null while loading or when the API predates the team feature. */
  me: Me | null;
  /** Legacy GET /businesses/me payload (subscription, onboarding status, ...). */
  business: any;
  niche: Niche;
  loaded: boolean;
  notifications: NotificationsSummary | null;
  refresh: () => Promise<void>;
  refreshNotifications: () => Promise<void>;
  can: (section: PermissionSection, level?: "view" | "edit") => boolean;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession must be used inside <SessionProvider>");
  return v;
}

const NOTIFICATION_POLL_MS = 20_000;

export function SessionProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [business, setBusiness] = useState<any>(null);
  const [loaded, setLoaded] = useState(false);
  const [notifications, setNotifications] = useState<NotificationsSummary | null>(null);

  const refresh = useCallback(async () => {
    const [m, b] = await Promise.allSettled([getAuthMe(), getMe()]);
    setMe(m.status === "fulfilled" ? m.value : null);
    setBusiness(b.status === "fulfilled" ? b.value : null);
    setLoaded(true);
  }, []);

  const refreshNotifications = useCallback(async () => {
    try {
      setNotifications(await getNotificationsSummary());
    } catch {
      // missing route or no access: badges simply stay hidden
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setMe(null);
      setBusiness(null);
      setNotifications(null);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    void refresh();
  }, [enabled, refresh]);

  const niche: Niche = (me?.business.niche ?? business?.niche ?? "imobiliaria") as Niche;
  const isPharmacy = niche === "farmacia";
  const polling = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!enabled || !loaded || !isPharmacy) return;
    void refreshNotifications();
    polling.current = setInterval(() => {
      if (document.visibilityState === "visible") void refreshNotifications();
    }, NOTIFICATION_POLL_MS);
    return () => {
      if (polling.current) clearInterval(polling.current);
    };
  }, [enabled, loaded, isPharmacy, refreshNotifications]);

  const value = useMemo<SessionValue>(
    () => ({
      me,
      business,
      niche,
      loaded,
      notifications,
      refresh,
      refreshNotifications,
      // without a member payload (older API) fall back to "allowed": the API still enforces
      can: (section, level = "view") => (me ? canDo(me, section, level) : true),
    }),
    [me, business, niche, loaded, notifications, refresh, refreshNotifications],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
