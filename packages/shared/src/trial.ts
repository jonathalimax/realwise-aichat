export function hasActivePaidSubscription(business: { subscription: { status: string } | null }) {
  return business.subscription?.status === "active";
}

// Mirrors trial-watch cron's suspend criteria, for request-time gating before the cron catches up.
export function isEffectivelySuspended(business: {
  trialEndsAt: Date | string | null;
  subscription: { status: string } | null;
}) {
  if (!business.trialEndsAt) return false;
  if (hasActivePaidSubscription(business)) return false;
  return new Date(business.trialEndsAt).getTime() <= Date.now();
}
