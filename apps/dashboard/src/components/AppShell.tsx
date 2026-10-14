"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "./shell/Sidebar";
import { NoAccess } from "./shell/NoAccess";
import { AlertsStrip } from "./shell/AlertsStrip";
import { BrandingApplier } from "./shell/BrandingApplier";
import { TrialEndedGate } from "./TrialEndedGate";
import { SessionProvider, useSession } from "../lib/session";
import { homeFor, isPublicRoute, requirementFor } from "../lib/nav";

// Pages reachable even when the trial has expired and there's no active subscription.
const ALLOWED_WHEN_SUSPENDED = ["/billing", "/plano", "/profile"];

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isPublic = isPublicRoute(pathname);
  return (
    <SessionProvider enabled={!isPublic}>
      {isPublic ? <>{children}</> : <ShellInner pathname={pathname}>{children}</ShellInner>}
    </SessionProvider>
  );
}

function ShellInner({ pathname, children }: { pathname: string; children: ReactNode }) {
  const router = useRouter();
  const { me, business, niche, loaded, can } = useSession();
  const isPharmacy = niche === "farmacia";

  // redirects that depend on who is signed in
  useEffect(() => {
    if (!loaded) return;
    if (business?.status === "onboarding" && pathname !== "/onboarding") {
      router.replace("/onboarding");
      return;
    }
    if (isPharmacy && pathname === "/") router.replace(homeFor(niche, me));
  }, [loaded, business?.status, pathname, isPharmacy, niche, me, router]);

  if (!loaded) return null;

  const suspended = business?.status === "suspended" && business?.subscription?.status !== "active";
  const gated = suspended && !ALLOWED_WHEN_SUSPENDED.includes(pathname);

  const req = requirementFor(pathname);
  const denied = req && me ? !can(req.section, req.level) : false;
  const redirecting = (isPharmacy && pathname === "/") || (business?.status === "onboarding" && pathname !== "/onboarding");

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <BrandingApplier branding={me?.business.branding} restyle={isPharmacy || Boolean(me?.business.brandingIsCustom)} shadcnUi={isPharmacy} />
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-x-hidden px-4 py-5 md:px-8 md:py-8">
        {isPharmacy && <AlertsStrip />}
        {redirecting ? null : gated ? <TrialEndedGate /> : denied && req ? <NoAccess section={req.section} /> : children}
      </main>
    </div>
  );
}
