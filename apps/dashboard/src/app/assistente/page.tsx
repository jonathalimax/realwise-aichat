"use client";

import { useState } from "react";
import { InterviewChat } from "../../components/InterviewChat";
import { getPharmacySettings } from "../../lib/pharmacy-api";
import { useLoad } from "../../lib/use-load";
import { Alert } from "../../components/ui/alert";
import { Card, CardContent } from "../../components/ui/card";
import { LinkButton, PageHeader, PageStack } from "../../components/page-kit";

/** Assistente: the onboarding interview for the pharmacy niche. Answers become suggestions in Farmácia (nothing is applied until confirmed). */
export default function AssistentePage() {
  const [filled, setFilled] = useState(0);
  const settings = useLoad(() => getPharmacySettings(), [filled]);
  const pending = Object.values(settings.data?.proposals ?? {}).filter((p) => p.status === "pending").length;

  return (
    <PageStack className="max-w-[820px]">
      <PageHeader
        title="Assistente"
        subtitle="Conte sobre a sua farmácia em uma conversa. O Alex usa as respostas para atender os clientes."
      />
      {pending > 0 && (
        <Alert variant="amber" action={<LinkButton href="/farmacia" variant="outline" size="sm">Revisar em Farmácia</LinkButton>}>
          {pending} {pending === 1 ? "resposta virou uma sugestão" : "respostas viraram sugestões"} de regra (taxa de entrega, horários, limites…). Nada é aplicado antes de você confirmar.
        </Alert>
      )}
      <Card>
        <CardContent>
          <InterviewChat assistantName="Alex" onFieldFilled={() => setFilled((n) => n + 1)} />
        </CardContent>
      </Card>
      <p className="text-xs text-muted">
        O Alex é um assistente de inteligência artificial e nunca indica medicamentos. Respostas sobre entrega, horários e limites ficam em “Farmácia” para você confirmar.
      </p>
    </PageStack>
  );
}
