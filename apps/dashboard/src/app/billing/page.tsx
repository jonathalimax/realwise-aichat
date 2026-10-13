"use client";

import { useEffect, useState } from "react";
import { PRICING_COPY, formatPlanPriceBrl, getPlanDefinition } from "@realwise/shared";
import { getMe, getPlans, startCheckout, openBillingPortal } from "../../lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";

// Shape returned by GET /billing/plans (apps/api/src/modules/billing/public-plans.ts), already in
// upgrade order: essencial -> profissional -> studio.
interface PublicPlan {
  code: string;
  name: string;
  priceBrlCents: number;
  listPriceBrlCents: number;
  recommended: boolean;
  highlights: string[];
}

// Same set the API treats as "already subscribed" — plan changes then go through the Stripe portal.
const LIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"];

export default function BillingPage() {
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [subscription, setSubscription] = useState<{ status: string; plan?: { code: string } } | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    Promise.all([
      getPlans().then(setPlans).catch(() => setPlans([])),
      getMe()
        .then((business) => setSubscription(business?.subscription ?? null))
        .catch(() => setSubscription(null)),
    ]).finally(() => setLoaded(true));
  }, []);

  const hasLiveSubscription = Boolean(subscription && LIVE_SUBSCRIPTION_STATUSES.includes(subscription.status));
  const currentPlanCode = hasLiveSubscription ? subscription?.plan?.code : undefined;
  const currentRank = plans.findIndex((p) => p.code === currentPlanCode);

  useEffect(() => {
    if (!loaded) return;
    const selectedPlan = localStorage.getItem("rw_selected_plan");
    if (!selectedPlan || plans.length === 0) return;
    localStorage.removeItem("rw_selected_plan");
    // Already subscribed: never open a second checkout; the owner switches plans in the portal.
    if (hasLiveSubscription) return;
    const match = plans.find((p) => p.code === selectedPlan);
    if (!match) return;
    setRedirecting(true);
    choosePlan(match.code);
  }, [loaded, plans, hasLiveSubscription]);

  async function choosePlan(code: string) {
    try {
      const { url } = await startCheckout(code);
      window.location.href = url;
    } catch (err) {
      setRedirecting(false);
      setError(err instanceof Error ? err.message : "Não foi possível iniciar o checkout.");
    }
  }

  async function managePlan() {
    try {
      const { url } = await openBillingPortal();
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível abrir o portal de cobrança.");
    }
  }

  function actionLabel(plan: PublicPlan, index: number) {
    if (!hasLiveSubscription) return `Escolher ${plan.name}`;
    if (currentRank >= 0 && index > currentRank) return `Fazer upgrade para ${plan.name}`;
    return `Trocar para ${plan.name}`;
  }

  return (
    <div>
      <h1 className="mb-2 font-serif text-2xl text-ink">Plano e cobrança</h1>
      <p className="mb-5 text-sm text-ink-soft">
        {currentPlanCode
          ? `Seu plano atual: ${getPlanDefinition(currentPlanCode)?.name ?? currentPlanCode}.`
          : "Escolha um plano para continuar usando a Realwise."}{" "}
        {PRICING_COPY.setupFree}
      </p>
      {redirecting && <p className="mb-4 text-sm text-ink-soft">Abrindo o checkout do plano escolhido…</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan, index) => {
          const isCurrent = plan.code === currentPlanCode;
          return (
            <Card key={plan.code} className="flex flex-col">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{plan.name}</CardTitle>
                  {isCurrent ? (
                    <Badge variant="positive">Plano atual</Badge>
                  ) : plan.recommended ? (
                    <Badge variant="accent">Mais escolhido</Badge>
                  ) : null}
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col pt-0">
                <div className="text-xs text-muted">
                  {PRICING_COPY.launchPriceLabel}{" "}
                  <s aria-label={`De ${formatPlanPriceBrl(plan.listPriceBrlCents)} por mês`}>{formatPlanPriceBrl(plan.listPriceBrlCents)}</s>
                </div>
                <div className="mb-4 font-mono text-xl text-ink">
                  {formatPlanPriceBrl(plan.priceBrlCents)}
                  <span className="font-sans text-sm text-muted">/mês</span>
                </div>
                <ul className="mb-4 flex flex-1 flex-col gap-1.5 text-sm text-ink-soft">
                  {plan.highlights.map((item) => (
                    <li key={item}>— {item}</li>
                  ))}
                </ul>
                <Button
                  className="w-full"
                  disabled={isCurrent || redirecting}
                  onClick={() => (hasLiveSubscription ? managePlan() : choosePlan(plan.code))}
                >
                  {isCurrent ? "Seu plano" : actionLabel(plan, index)}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="mt-4 max-w-3xl text-xs text-ink-soft">
        {PRICING_COPY.conversationDefinition} {PRICING_COPY.overQuota}
      </p>
      {subscription && (
        <button onClick={managePlan} className="mt-6 text-sm text-accent underline">
          Gerenciar assinatura
        </button>
      )}
      {error && <p className="mt-3 text-sm text-negative">{error}</p>}
    </div>
  );
}
