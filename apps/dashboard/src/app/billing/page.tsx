"use client";

import { useEffect, useState } from "react";
import { getPlans, startCheckout, openBillingPortal } from "../../lib/api";

export default function BillingPage() {
  const [plans, setPlans] = useState<any[]>([]);

  useEffect(() => {
    getPlans().then(setPlans).catch(() => setPlans([]));
  }, []);

  async function choosePlan(code: string) {
    const { url } = await startCheckout(code);
    window.location.href = url;
  }

  async function managePlan() {
    const { url } = await openBillingPortal();
    window.location.href = url;
  }

  return (
    <div>
      <h1 className="mb-5 font-serif text-2xl text-ink">Plano e cobrança</h1>
      <div className="grid grid-cols-3 gap-4">
        {plans.map((plan) => (
          <div key={plan.id} className="rounded-card border border-border bg-surface p-5">
            <h3 className="font-serif text-lg">{plan.name}</h3>
            <div className="my-2 font-mono text-xl">R$ {(plan.priceBrlCents / 100).toFixed(2)}/mês</div>
            <button onClick={() => choosePlan(plan.code)} className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
              Escolher
            </button>
          </div>
        ))}
      </div>
      <button onClick={managePlan} className="mt-6 text-sm text-accent underline">
        Gerenciar assinatura atual
      </button>
    </div>
  );
}
