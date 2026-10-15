// One dashboard codebase, served as three containers under one prefix per niche on the same domain.
// Everything that needs "where does this niche's dashboard live" (emails, login redirects, build config
// docs) reads it from here so the three prefixes are defined exactly once.
export type DashboardNiche = "imobiliaria" | "concessionaria" | "farmacia";

export const DASHBOARD_BASE_PATHS: Record<DashboardNiche, string> = {
  imobiliaria: "/imobiliaria/app",
  concessionaria: "/concessionaria/app",
  farmacia: "/farmacia/app",
};

/** Dashboard prefix of a niche. Unknown / missing niche falls back to the real-estate dashboard (the original one). */
export function dashboardBasePath(niche: string | null | undefined): string {
  return niche === "farmacia" || niche === "concessionaria" ? DASHBOARD_BASE_PATHS[niche] : DASHBOARD_BASE_PATHS.imobiliaria;
}

/** True when a member of `niche` is looking at a dashboard served under `currentBasePath` that is not theirs. */
export function isWrongDashboardPrefix(niche: string | null | undefined, currentBasePath: string): boolean {
  return currentBasePath.replace(/\/+$/, "") !== dashboardBasePath(niche);
}

/**
 * Where to send a member to reach `path` (an in-app path such as "/inicio") on THEIR dashboard.
 * Same prefix as the page they are on: `crossPrefix` false and `href` is the in-app path (use router.push).
 * Different prefix (e.g. a pharmacy member who logged in at /imobiliaria/app/login): `crossPrefix` true and
 * `href` is the absolute path on the right prefix (use a full navigation, the other prefix is another container).
 */
export function dashboardRedirect(
  niche: string | null | undefined,
  path: string,
  currentBasePath: string,
): { crossPrefix: boolean; href: string } {
  const inApp = path.startsWith("/") ? path : `/${path}`;
  if (!isWrongDashboardPrefix(niche, currentBasePath)) return { crossPrefix: false, href: inApp };
  return { crossPrefix: true, href: `${dashboardBasePath(niche)}${inApp === "/" ? "" : inApp}` };
}
