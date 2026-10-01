"use client";

import { useEffect, useState } from "react";
import { getPlans, startCheckout, openBillingPortal } from "../../lib/api";
import { Card, CardHeader, CardTitle, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";

export default function BillingPage() {
  const [plans, setPlans] = useState<any[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    getPlans().then(setPlans).catch(() => setPlans([]));
  }, []);

  async function choosePlan(code: string) {
    try {
      const { url } = await startCheckout(code);
      window.location.href = url;
    } catch (err) {
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => (
          <Card key={plan.id}>
            <CardHeader>
              <CardTitle>{plan.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 font-mono text-xl text-ink">R$ {(plan.priceBrlCents / 100).toFixed(2)}/mês</div>
              <Button className="w-full" onClick={() => choosePlan(plan.code)}>
                Escolher
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <button onClick={managePlan} className="mt-6 text-sm text-accent underline">
        Gerenciar assinatura atual
      </button>
      {error && <p className="mt-3 text-sm text-negative">{error}</p>}
    </div>
  );
}
