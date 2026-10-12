"use client";

import { useEffect, useState } from "react";
import { getPlans, startCheckout, openBillingPortal } from "../../lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";

export default function BillingPage() {
  const [plans, setPlans] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    getPlans().then(setPlans).catch(() => setPlans([]));
  }, []);

  useEffect(() => {
    const selectedPlan = localStorage.getItem("rw_selected_plan");
    if (!selectedPlan || plans.length === 0) return;
    const match = plans.find((p) => p.code === selectedPlan);
    if (!match) return;
    localStorage.removeItem("rw_selected_plan");
    setRedirecting(true);
    choosePlan(match.code);
  }, [plans]);

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

  return (
    <div>
      <h1 className="mb-5 font-serif text-2xl text-ink">Plano e cobrança</h1>
      {redirecting && <p className="mb-4 text-sm text-ink-soft">Abrindo o checkout do plano escolhido…</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => (
          <Card key={plan.id}>
            <CardHeader>
              <CardTitle>{plan.name}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="mb-4 font-mono text-xl text-ink">R$ {(plan.priceBrlCents / 100).toFixed(2)}/mês</div>
              <Button className="w-full" onClick={() => choosePlan(plan.code)}>
                Escolher
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <button onClick={managePlan} className="mt-6 text-sm text-accent underline">
        Gerenciar assinatura
      </button>
      {error && <p className="mt-3 text-sm text-negative">{error}</p>}
    </div>
  );
}
