"use client";

import { useEffect, useState } from "react";
import { getConversationProblemCases } from "../../lib/api";
import { Sheet, SheetContent } from "../ui/sheet";
import { Badge, type BadgeProps } from "../ui/badge";
import { SegmentedControl } from "../ui/segmented";

const CATEGORY_LABELS: Record<string, string> = {
  no_context: "Sem contexto na base",
  grounding_guard: "Bloqueado por alucinação",
  gateway_error: "Erro no gateway",
  model_abstained: "IA declinou responder",
  escalated: "Escalado p/ humano",
  flagged: "Sinalizado",
  negative_feedback: "Feedback negativo",
};

const CATEGORY_BADGE_VARIANT: Record<string, BadgeProps["variant"]> = {
  no_context: "warning",
  grounding_guard: "warning",
  gateway_error: "negative",
  model_abstained: "neutral",
  escalated: "accent",
  flagged: "negative",
  negative_feedback: "negative",
};

const CATEGORY_OPTIONS = [
  { label: "Sem contexto", value: "no_context" },
  { label: "Bloqueado", value: "grounding_guard" },
  { label: "Erro gateway", value: "gateway_error" },
  { label: "IA declinou", value: "model_abstained" },
  { label: "Escalado", value: "escalated" },
] as const;

function formatMs(ms: number | null) {
  if (ms === null || ms === undefined) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export interface ProblemCasesDrawerProps {
  open: boolean;
  onClose: () => void;
  businessId?: string;
  businessName?: string;
  category?: string;
  days: number;
}

export function ProblemCasesDrawer({ open, onClose, businessId, businessName, category, days }: ProblemCasesDrawerProps) {
  const [activeCategory, setActiveCategory] = useState<string | undefined>(category);
  const [data, setData] = useState<any>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setActiveCategory(category);
    setOffset(0);
  }, [category, businessId, open]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    getConversationProblemCases({ days, businessId, category: activeCategory, offset })
      .then((result) => {
        setData((prev: any) =>
          offset === 0 ? result : { ...result, items: [...(prev?.items ?? []), ...result.items] },
        );
      })
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [open, days, businessId, activeCategory, offset]);

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-full max-w-xl sm:w-[32rem] sm:max-w-none">
        <div className="flex h-full flex-col overflow-hidden">
          <div className="border-b border-border p-4 sm:p-6">
            <h2 className="font-serif text-lg text-ink">Casos de problema{businessName ? ` — ${businessName}` : ""}</h2>
            <p className="mt-1 text-xs text-ink-soft">Últimos {days} dias</p>
            <SegmentedControl
              value={(activeCategory ?? "") as any}
              onValueChange={(v) => {
                setActiveCategory(v);
                setOffset(0);
                setData(null);
              }}
              options={CATEGORY_OPTIONS as any}
              className="mt-3"
            />
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6">
            {!data && loading ? (
              <p className="text-ink-soft">Carregando…</p>
            ) : !data || data.items.length === 0 ? (
              <p className="text-center text-ink-soft">Nenhum caso neste período.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {data.items.map((item: any) => (
                  <div key={item.messageId} className="rounded-lg border border-border bg-bg-2 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant={CATEGORY_BADGE_VARIANT[item.category] ?? "neutral"}>
                        {CATEGORY_LABELS[item.category] ?? item.category}
                      </Badge>
                      <div className="text-xs text-ink-soft">
                        {new Date(item.createdAt).toLocaleString("pt-BR")} · {formatMs(item.latencyMs)}
                      </div>
                    </div>

                    <div className="mt-3">
                      <div className="text-xs font-semibold text-ink-soft">Pergunta do visitante</div>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-ink">
                        {item.questionText ?? <span className="italic text-ink-soft">Sem pergunta registrada</span>}
                      </p>
                    </div>

                    <div className="mt-3">
                      <div className="text-xs font-semibold text-ink-soft">Resposta da IA</div>
                      {item.answerText ? (
                        <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{item.answerText}</p>
                      ) : (
                        <p className="mt-1 text-sm italic text-ink-soft">Sem resposta</p>
                      )}
                    </div>

                    {item.category === "gateway_error" && item.gatewayError ? (
                      <div className="mt-3">
                        <div className="text-xs font-semibold text-ink-soft">Erro registrado (correlação aproximada)</div>
                        <pre className="mt-1 whitespace-pre-wrap rounded bg-surface p-2 text-xs text-ink-soft">
                          {item.gatewayError}
                        </pre>
                      </div>
                    ) : null}

                    <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-soft">
                      <span>modelo: {item.modelUsed ?? "—"}</span>
                      <span>score: {item.retrievalTopScore ?? "—"}</span>
                      <span>chunks: {item.retrievedChunkCount}</span>
                      <span className="font-mono">{item.conversationId}</span>
                    </div>
                  </div>
                ))}

                {data.hasMore ? (
                  <button
                    type="button"
                    onClick={() => setOffset((prev) => prev + (data.limit ?? 25))}
                    disabled={loading}
                    className="self-center rounded-lg border border-border px-4 py-1.5 text-xs font-medium text-ink-soft hover:bg-surface disabled:opacity-50"
                  >
                    {loading ? "Carregando…" : "Carregar mais"}
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
