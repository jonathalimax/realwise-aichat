"use client";

import { useState } from "react";
import Link from "next/link";
import { getPlanDefinition, type OperationMode } from "@realwise/shared";
import { dismissProposal, savePharmacySettings, type PharmacySettingsDto } from "../../../lib/pharmacy-api";
import { ApiError } from "../../../lib/api";
import { errorMessage } from "../../../lib/use-load";
import { cn } from "../../../lib/utils";
import { timeAgo } from "../../../lib/format";
import { Alert } from "../../ui/alert";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { SectionCard } from "../../page-kit";

const OPTIONS: { value: OperationMode; title: string; description: string; bullets: string[] }[] = [
  {
    value: "commerce",
    title: "Comércio: estoque e vendas pelo sistema",
    description: "O Alex monta o pedido no chat, a farmácia controla o estoque e a entrega.",
    bullets: ["Catálogo, estoque e importação de planilha", "Carrinho e pedidos no chat, com entrega ou retirada", "Receitas e revisão de classes pelo farmacêutico", "Atendimento ao farmacêutico para sintomas e dúvidas"],
  },
  {
    value: "attendance",
    title: "Atendimento: só a IA, com encaminhamento",
    description: "Como um WhatsApp com IA: o Alex responde dúvidas gerais e encaminha tudo sobre produtos ao farmacêutico.",
    bullets: ["Horários, entrega, retirada, pagamento e perguntas frequentes", "Sintomas e sinais de alerta encaminhados ao farmacêutico", "Perguntas sobre produto, preço ou estoque viram atendimento (o farmacêutico confirma)", "Sem catálogo, estoque, carrinho, pedidos ou receitas online"],
  },
];

/** Farmácia > Modo de operação. Only the owner changes it; commerce is disabled when the plan lacks it. */
export function ModeTab({ dto, isOwner, onSaved }: { dto: PharmacySettingsDto; isOwner: boolean; onSaved: (next: PharmacySettingsDto) => void }) {
  const mode = dto.mode;
  const stored: OperationMode = (dto.settings.operationMode ?? mode?.chosen ?? "commerce") as OperationMode;
  const [picked, setPicked] = useState<OperationMode>(stored);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const commerceAllowed = mode?.commerceAllowedByPlan ?? true;
  const upgrade = mode?.upgradeToPlanCode ? getPlanDefinition(mode.upgradeToPlanCode)?.name : "Profissional";
  const pendingProposal = dto.proposals.modo_operacao?.status === "pending";
  const chosenAt = dto.settings.operationModeChosenAt ?? mode?.chosenAt ?? null;
  const dirty = picked !== stored || (!chosenAt && isOwner);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      let next = await savePharmacySettings({ operationMode: picked });
      // The owner decided here: the interview suggestion for the mode is settled.
      if (pendingProposal) next = await dismissProposal("modo_operacao");
      onSaved(next);
      setMessage({ kind: "ok", text: picked === "attendance" ? "Modo atendimento ativo. Catálogo e pedidos ficam guardados, só não aparecem." : "Modo comércio ativo." });
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      setMessage({
        kind: "error",
        text: code === "PLAN_FEATURE" ? `Disponível a partir do plano ${upgrade}.` : code === "OWNER_PROTECTED" ? "Só o proprietário muda o modo de operação." : errorMessage(e),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title="Modo de operação"
      description={chosenAt ? `Definido ${timeAgo(chosenAt)}` : "Ainda não confirmado: escolha como a farmácia vai usar o sistema"}
      action={mode ? <Badge variant={mode.effective === "commerce" ? "green" : "soft"}>{mode.effective === "commerce" ? "Em uso: comércio" : "Em uso: atendimento"}</Badge> : undefined}
    >
      <div className="flex flex-col gap-4">
        {mode?.forcedByPlan && (
          <Alert
            variant="amber"
            title="O plano atual só permite o modo atendimento"
            action={<Link href="/plano" className="text-[13px] font-semibold text-accent hover:underline">Ver planos</Link>}
          >
            A farmácia está configurada como comércio, mas está rodando em atendimento até o plano ser ajustado ({upgrade} ou superior). Catálogo, estoque e pedidos ficam guardados e voltam sozinhos com o upgrade.
          </Alert>
        )}
        {pendingProposal && (
          <Alert variant="amber">A entrevista com o Assistente sugeriu um modo (veja “Sugestões do Assistente” acima). Ao confirmar o modo aqui, a sugestão é encerrada.</Alert>
        )}
        {!isOwner && <Alert variant="soft">Só o proprietário muda o modo de operação.</Alert>}
        <div role="radiogroup" aria-label="Modo de operação" className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4">
          {OPTIONS.map((o) => {
            const disabled = !isOwner || (o.value === "commerce" && !commerceAllowed);
            const selected = picked === o.value;
            return (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled && !selected}
                onClick={() => !disabled && setPicked(o.value)}
                className={cn(
                  "flex flex-col gap-2 rounded-[12px] border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  selected ? "border-accent bg-brand-soft" : "border-border bg-surface hover:bg-bg-2",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <b className="text-ink">{o.title}</b>
                  {o.value === "commerce" && !commerceAllowed && <Badge variant="amber">Disponível a partir do plano {upgrade}</Badge>}
                </span>
                <span className="text-[13px] text-muted">{o.description}</span>
                <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4 text-[13px] text-ink-soft">
                  {o.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>
        {!commerceAllowed && (
          <p className="text-[13px] text-muted">
            O modo comércio está disponível a partir do plano {upgrade}. <Link href="/plano" className="font-semibold text-accent hover:underline">Ver planos</Link>
          </p>
        )}
        {picked === "attendance" && stored === "commerce" && (
          <Alert variant="soft">Ao trocar para atendimento, Pedidos e Catálogo saem do menu e o Alex para de vender. Nada é apagado: os dados voltam se você retornar ao modo comércio.</Alert>
        )}
        {message && <Alert variant={message.kind === "ok" ? "soft" : "red"}>{message.text}</Alert>}
        {isOwner && (
          <div>
            <Button disabled={busy || !dirty} onClick={save}>
              {busy ? "Salvando…" : "Confirmar modo de operação"}
            </Button>
          </div>
        )}
      </div>
    </SectionCard>
  );
}
