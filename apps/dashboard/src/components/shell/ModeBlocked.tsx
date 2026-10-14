"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { getPlanDefinition } from "@realwise/shared";
import { Card, CardContent } from "../ui/card";
import { buttonVariants } from "../ui/button";
import { cn } from "../../lib/utils";
import { homeFor } from "../../lib/nav";
import { useSession } from "../../lib/session";

/**
 * Shown on a commerce page (Pedidos, Catálogo, importar, classes) while the pharmacy runs in attendance mode.
 * Forced by the plan: banner with the upgrade CTA. Chosen by the owner: points to Farmácia > Modo de operação.
 * Data is never deleted: it comes back as soon as the mode is commerce again.
 */
export function ModeBlocked() {
  const { me, niche } = useSession();
  const info = me?.business.operationMode;
  const forced = Boolean(info && !info.commerceAllowedByPlan);
  const upgrade = info?.upgradeToPlanCode ? getPlanDefinition(info.upgradeToPlanCode)?.name : null;
  const isOwner = me?.role.key === "owner";
  return (
    <div className="flex min-h-[60dvh] items-center justify-center">
      <Card className="w-full max-w-[520px]">
        <CardContent className="flex flex-col items-center gap-3.5 px-8 py-10 text-center">
          <span className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-amber-100 text-amber-800">
            <Lock className="h-6 w-6" aria-hidden />
          </span>
          <h1 className="text-xl font-bold tracking-tight text-ink">
            {forced ? "Catálogo, estoque e pedidos fazem parte do modo comércio" : "Esta farmácia está no modo atendimento"}
          </h1>
          <p className="text-sm text-muted">
            {forced
              ? `O plano atual só permite o modo atendimento (a IA atende e encaminha ao farmacêutico). O modo comércio está disponível a partir do plano ${upgrade ?? "Profissional"}. Seus dados de catálogo e pedidos continuam guardados e voltam quando o plano permitir.`
              : "A IA atende e encaminha tudo sobre produtos ao farmacêutico, sem catálogo, estoque ou pedidos. Os dados já cadastrados continuam guardados."}
          </p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            {forced && (
              <Link href="/plano" className={cn(buttonVariants())}>
                Ver planos{upgrade ? ` (${upgrade})` : ""}
              </Link>
            )}
            {!forced && isOwner && (
              <Link href="/farmacia?tab=modo" className={cn(buttonVariants())}>
                Mudar o modo de operação
              </Link>
            )}
            <Link href={homeFor(niche, me)} className={cn(buttonVariants({ variant: "outline" }))}>
              Voltar ao início
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
