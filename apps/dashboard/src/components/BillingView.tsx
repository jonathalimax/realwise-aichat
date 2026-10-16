"use client";

import { useEffect, useState } from "react";
import { PRICING_COPY, formatPlanPriceBrl, getPlanDefinition, pharmacyPlanHighlights } from "@realwise/shared";
import { getMe, getPlans, startCheckout, openBillingPortal } from "../lib/api";
import { useSession } from "../lib/session";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Alert } from "./ui/alert";
import { Progress } from "./ui/progress";
import { PageHeader, PageStack, ErrorState } from "./page-kit";

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

// Same set the API treats as "already subscribed": plan changes then go through the Stripe portal.
const LIVE_SUBSCRIPTION_STATUSES = ["active", "trialing", "past_due"];
const STATUS_LABEL: Record<string, string> = { active: "Ativo", trialing: "Período de teste", past_due: "Pagamento pendente", canceled: "Cancelado" };

interface Subscription {
  status: string;
  plan?: { code: string; name?: string; priceBrlCents?: number; conversationQuota?: number };
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  conversationsUsedThisPeriod?: number;
}

/** Plan + billing. Used by /billing (real estate) and /plano (pharmacy); Stripe handles invoices and payment methods. */
export function BillingView({ title = "Plano e cobrança" }: { title?: string }) {
  const { can, niche } = useSession();
  const canEdit = can("plano", "edit");
  // Pharmacy: also say what each plan allows (commerce mode needs Profissional or Studio).
  const highlightsOf = (plan: PublicPlan): string[] => {
    const def = getPlanDefinition(plan.code);
    return niche === "farmacia" && def ? [...plan.highlights, ...pharmacyPlanHighlights(def)] : plan.highlights;
  };
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [error, setError] = useState("");
  const [redirecting, setRedirecting] = useState(false);

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setLoadError(null);
    Promise.all([
      getPlans().then(setPlans),
      getMe().then((business) => setSubscription(business?.subscription ?? null)),
    ])
      .catch((e) => setLoadError(e instanceof Error ? e : new Error(String(e))))
      .finally(() => setLoaded(true));
  }, [attempt]);

  const hasLiveSubscription = Boolean(subscription && LIVE_SUBSCRIPTION_STATUSES.includes(subscription.status));
  const currentPlanCode = hasLiveSubscription ? subscription?.plan?.code : undefined;
  const currentRank = plans.findIndex((p) => p.code === currentPlanCode);
  const currentPlan = plans.find((p) => p.code === currentPlanCode);

  useEffect(() => {
    if (!loaded || !canEdit) return;
    const selectedPlan = localStorage.getItem("rw_selected_plan");
    if (!selectedPlan || plans.length === 0) return;
    localStorage.removeItem("rw_selected_plan");
    // Already subscribed: never open a second checkout; the owner switches plans in the portal.
    if (hasLiveSubscription) return;
    const match = plans.find((p) => p.code === selectedPlan);
    if (!match) return;
    setRedirecting(true);
    choosePlan(match.code);
  }, [loaded, plans, hasLiveSubscription]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const quota = subscription?.plan?.conversationQuota;
  const used = subscription?.conversationsUsedThisPeriod ?? 0;

  return (
    <PageStack>
      <PageHeader
        title={title}
        subtitle={
          currentPlanCode
            ? `Seu plano atual: ${getPlanDefinition(currentPlanCode)?.name ?? currentPlanCode}. ${PRICING_COPY.setupFree}`
            : `Escolha um plano para continuar usando a Realwise. ${PRICING_COPY.setupFree}`
        }
      />
      {!canEdit && <Alert variant="amber">Você pode ver o plano, mas só proprietários e gerentes alteram a cobrança.</Alert>}
      {redirecting && <p className="text-sm text-muted">Abrindo o checkout do plano escolhido…</p>}
      {loadError && <ErrorState error={loadError} what="o plano" onRetry={() => setAttempt((n) => n + 1)} />}

      {hasLiveSubscription && subscription && (
        <div className="flex flex-wrap gap-4">
          <Card className="min-w-0 flex-[1_1_340px]">
            <CardHeader>
              <CardTitle>Plano atual</CardTitle>
              <CardDescription>
                {subscription.currentPeriodEnd
                  ? `${subscription.cancelAtPeriodEnd ? "Termina" : "Renova"} em ${new Date(subscription.currentPeriodEnd).toLocaleDateString("pt-BR", { day: "numeric", month: "long" })}`
                  : "Assinatura ativa"}
              </CardDescription>
              <Badge variant={subscription.status === "past_due" ? "amber" : "default"} className="sm:col-start-2 sm:row-start-1 sm:justify-self-end">
                {currentPlan?.name ?? subscription.plan?.name ?? getPlanDefinition(currentPlanCode ?? "")?.name ?? "Plano"}
              </Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-3.5">
              {currentPlan && (
                <div>
                  <span className="text-[32px] font-bold tracking-tight">{formatPlanPriceBrl(currentPlan.priceBrlCents)}</span>
                  <span className="text-muted"> /mês</span>
                </div>
              )}
              <div className="text-[13px] text-muted">Situação: {STATUS_LABEL[subscription.status] ?? subscription.status}</div>
              {canEdit && (
                <div className="flex flex-wrap gap-2">
                  <Button onClick={managePlan}>Gerenciar assinatura</Button>
                </div>
              )}
            </CardContent>
          </Card>
          {typeof quota === "number" && quota > 0 && (
            <Card className="min-w-0 flex-[1_1_340px]">
              <CardHeader>
                <CardTitle>Uso do mês</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-1.5">
                <div className="flex justify-between text-[13px]">
                  <span>Conversas com o assistente</span>
                  <b>
                    {used.toLocaleString("pt-BR")} de {quota.toLocaleString("pt-BR")}
                  </b>
                </div>
                <Progress value={(used / quota) * 100} />
                <p className="mt-2 text-xs text-muted">Faturas e forma de pagamento ficam no portal de cobrança (“Gerenciar assinatura”).</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan, index) => {
          const isCurrent = plan.code === currentPlanCode;
          return (
            <Card key={plan.code} className="flex flex-col">
              <CardHeader>
                <CardTitle>{plan.name}</CardTitle>
                {isCurrent ? (
                  <Badge variant="positive" className="sm:col-start-2 sm:row-start-1 sm:justify-self-end">Plano atual</Badge>
                ) : plan.recommended ? (
                  <Badge variant="accent" className="sm:col-start-2 sm:row-start-1 sm:justify-self-end">Mais escolhido</Badge>
                ) : null}
              </CardHeader>
              <CardContent className="flex flex-1 flex-col">
                <div className="text-xs text-muted">
                  {PRICING_COPY.launchPriceLabel}{" "}
                  <s aria-label={`De ${formatPlanPriceBrl(plan.listPriceBrlCents)} por mês`}>{formatPlanPriceBrl(plan.listPriceBrlCents)}</s>
                </div>
                <div className="mb-4 font-mono text-xl text-ink">
                  {formatPlanPriceBrl(plan.priceBrlCents)}
                  <span className="font-sans text-sm text-muted">/mês</span>
                </div>
                <ul className="mb-4 flex flex-1 flex-col gap-1.5 text-sm text-ink-soft">
                  {highlightsOf(plan).map((item) => (
                    <li key={item}>— {item}</li>
                  ))}
                </ul>
                <Button className="w-full" disabled={isCurrent || redirecting || !canEdit} onClick={() => (hasLiveSubscription ? managePlan() : choosePlan(plan.code))}>
                  {isCurrent ? "Seu plano" : actionLabel(plan, index)}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="max-w-3xl text-xs text-ink-soft">
        {PRICING_COPY.conversationDefinition} {PRICING_COPY.overQuota}
      </p>
      {error && <p className="text-sm text-negative">{error}</p>}
    </PageStack>
  );
}
