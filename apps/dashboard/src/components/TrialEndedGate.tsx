"use client";

import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardContent } from "./ui/card";
import { Button } from "./ui/button";

export function TrialEndedGate() {
  const router = useRouter();

  return (
    <div className="mx-auto flex max-w-md flex-col items-center pt-16 text-center">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Seu período de teste terminou</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="mb-5 text-sm text-ink-soft">
            Para continuar usando a Realwise — Leads, Analytics, Base de conhecimento e Agenda — escolha um plano.
          </p>
          <Button className="w-full" onClick={() => router.push("/billing")}>
            Assinar um plano
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
