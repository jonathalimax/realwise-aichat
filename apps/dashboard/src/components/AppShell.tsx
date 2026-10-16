"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./shell/Sidebar";
import { NoAccess } from "./shell/NoAccess";
import { ModeBlocked } from "./shell/ModeBlocked";
import { AlertsStrip } from "./shell/AlertsStrip";
import { BrandingApplier } from "./shell/BrandingApplier";
import { TrialEndedGate } from "./TrialEndedGate";
import { isWrongDashboardPrefix, dashboardRedirect } from "@realwise/shared";
import { BASE_PATH_PREFIX } from "../lib/api";
import { SessionProvider, useSession } from "../lib/session";
import { LiveProvider } from "../lib/live";
import { homeFor, isCommerceRoute, isPublicRoute, modeOf, navFor, requirementFor } from "../lib/nav";

// Pages reachable even when the trial has expired and there's no active subscription.
const ALLOWED_WHEN_SUSPENDED = ["/billing", "/plano", "/profile"];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPublic = isPublicRoute(pathname);
  return (
    <SessionProvider enabled={!isPublic}>
      <LiveProvider enabled={!isPublic}>{isPublic ? <>{children}</> : <ShellInner pathname={pathname}>{children}</ShellInner>}</LiveProvider>
    </SessionProvider>
  );
}

function ShellInner({ pathname, children }: { pathname: string; children: ReactNode }) {
  const router = useRouter();
  const { me, business, niche, loaded, can } = useSession();
  const isPharmacy = niche === "farmacia";

  // A signed-in member opening another niche's prefix (e.g. a pharmacy member at /imobiliaria/app/...) is sent to
  // their own dashboard: each prefix is its own container with its own login look and menu.
  const sessionNiche = me?.business.niche ?? business?.niche;
  const wrongPrefix = loaded && Boolean(sessionNiche) && isWrongDashboardPrefix(sessionNiche, BASE_PATH_PREFIX);
  useEffect(() => {
    if (wrongPrefix) window.location.replace(dashboardRedirect(sessionNiche, pathname, BASE_PATH_PREFIX).href);
  }, [wrongPrefix, sessionNiche, pathname]);

  // redirects that depend on who is signed in
  useEffect(() => {
    if (!loaded || wrongPrefix) return;
    if (business?.status === "onboarding" && pathname !== "/onboarding") {
      router.replace("/onboarding");
      return;
    }
    if (isPharmacy && pathname === "/") router.replace(homeFor(niche, me));
  }, [loaded, wrongPrefix, business?.status, pathname, isPharmacy, niche, me, router]);

  // Page title per section ("Pedidos · Farmácia Exemplo"), keeping the live "(N)" pending badge in front.
  const businessName = me?.business.name;
  useEffect(() => {
    if (!loaded) return;
    const items = navFor(niche).flatMap((g) => g.items);
    const hit =
      items.filter((i) => pathname === i.href || pathname.startsWith(`${i.href}/`)).sort((a, b) => b.href.length - a.href.length)[0] ?? null;
    const label = hit?.label ?? (pathname === "/sem-acesso" ? "Sem acesso" : null);
    if (!label) return;
    const badge = document.title.match(/^\(\d+\)\s*/)?.[0] ?? "";
    document.title = `${badge}${label}${businessName ? ` · ${businessName}` : ""}`;
  }, [loaded, pathname, niche, businessName]);

  if (!loaded || wrongPrefix) return null;

  const suspended = business?.status === "suspended" && business?.subscription?.status !== "active";
  const gated = suspended && !ALLOWED_WHEN_SUSPENDED.includes(pathname);

  const req = requirementFor(pathname);
  const denied = req && me ? !can(req.section, req.level) : false;
  const modeBlocked = isPharmacy && !denied && modeOf(me) === "attendance" && isCommerceRoute(pathname);
  const redirecting = (isPharmacy && pathname === "/") || (business?.status === "onboarding" && pathname !== "/onboarding");

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <BrandingApplier branding={me?.business.branding} restyle={isPharmacy || Boolean(me?.business.brandingIsCustom)} shadcnUi={isPharmacy} />
      <Sidebar />
      <main className="outline-none min-w-0 flex-1 overflow-x-hidden px-4 py-5 md:px-8 md:py-8">
        {isPharmacy && <AlertsStrip />}
        {redirecting ? null : gated ? <TrialEndedGate /> : denied && req ? <NoAccess section={req.section} /> : modeBlocked ? <ModeBlocked /> : children}
      </main>
    </div>
  );
}
