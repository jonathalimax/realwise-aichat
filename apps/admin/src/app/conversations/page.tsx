"use client";

import { useEffect, useState } from "react";
import { getConversationInsights } from "../../lib/api";
import { StatCard } from "../../components/ui/stat-card";
import { SegmentedControl } from "../../components/ui/segmented";
import { Card, CardHeader, CardTitle, CardContent } from "../../components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../../components/ui/table";
import { ProblemCasesDrawer } from "../../components/conversations/ProblemCasesDrawer";

type Drill = { businessId?: string; businessName?: string; category: string };

const RANGE_OPTIONS = [
  { label: "Últimos 7 dias", value: "7" },
  { label: "Últimos 30 dias", value: "30" },
  { label: "Últimos 3 meses", value: "90" },
] as const;

function formatMs(ms: number | null) {
  if (ms === null) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

// Light-traffic costs are often sub-cent — fixed .toFixed(2) would show "$0.00" for real non-zero usage.
function formatCostUsd(value: number): string {
  return value > 0 && value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

export default function ConversationsPage() {
  const [range, setRange] = useState<(typeof RANGE_OPTIONS)[number]["value"]>("7");
  const [data, setData] = useState<any>(null);
  const [drill, setDrill] = useState<Drill | null>(null);

  useEffect(() => {
    getConversationInsights(Number(range)).then(setData).catch(() => setData(null));
  }, [range]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="font-serif text-2xl text-ink">Conversas</h1>
        <SegmentedControl value={range} onValueChange={setRange} options={RANGE_OPTIONS} className="self-start" />
      </div>

      {!data ? (
        <p className="text-ink-soft">Carregando…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Respostas da IA" value={data.totalMessages} />
            <button
              type="button"
              disabled={data.bySource.abstained === 0}
              onClick={() => setDrill({ category: "model_abstained" })}
              className="text-left disabled:cursor-default"
            >
              <StatCard
                label="Ficou em silêncio"
                value={data.bySource.abstained}
                context={pct(data.abstentionRate)}
              />
            </button>
            <button
              type="button"
              disabled={data.bySource.escalation === 0}
              onClick={() => setDrill({ category: "escalated" })}
              className="text-left disabled:cursor-default"
            >
              <StatCard
                label="Escalado p/ humano"
                value={data.bySource.escalation}
                context={pct(data.escalationRate)}
              />
            </button>
            <StatCard label="Tempo de resposta" value={formatMs(data.medianLatencyMs)} context={`mediana · média ${formatMs(data.avgLatencyMs)}`} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Por tipo de resposta</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 pt-0 sm:grid-cols-4">
              <div>
                <div className="text-xs text-ink-soft">Fluxo guiado</div>
                <div className="text-xl font-semibold text-ink">{data.bySource.fixed_flow}</div>
              </div>
              <div>
                <div className="text-xs text-ink-soft">IA (RAG)</div>
                <div className="text-xl font-semibold text-ink">{data.bySource.rag}</div>
              </div>
              <div>
                <div className="text-xs text-ink-soft">Silêncio</div>
                <div className="text-xl font-semibold text-ink">{data.bySource.abstained}</div>
              </div>
              <div>
                <div className="text-xs text-ink-soft">Escalado</div>
                <div className="text-xl font-semibold text-ink">{data.bySource.escalation}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Por cliente</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {data.perBusiness.length === 0 ? (
                <p className="text-center text-ink-soft">Nenhuma conversa neste período.</p>
              ) : (
                <>
                  <div className="hidden lg:block">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Respostas</TableHead>
                          <TableHead>Silêncio</TableHead>
                          <TableHead>Escalado</TableHead>
                          <TableHead>Sinalizado</TableHead>
                          <TableHead>Feedback negativo</TableHead>
                          <TableHead>Mediana resposta</TableHead>
                          <TableHead>Custo estimado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.perBusiness.map((b: any) => (
                          <TableRow key={b.businessId}>
                            <TableCell>{b.businessName}</TableCell>
                            <TableCell>{b.total}</TableCell>
                            <TableCell>
                              {b.abstained > 0 ? (
                                <button
                                  type="button"
                                  className="underline decoration-dotted decoration-ink-soft hover:text-ink"
                                  onClick={() =>
                                    setDrill({ businessId: b.businessId, businessName: b.businessName, category: "model_abstained" })
                                  }
                                >
                                  {b.abstained}
                                </button>
                              ) : (
                                b.abstained
                              )}
                            </TableCell>
                            <TableCell>
                              {b.escalated > 0 ? (
                                <button
                                  type="button"
                                  className="underline decoration-dotted decoration-ink-soft hover:text-ink"
                                  onClick={() =>
                                    setDrill({ businessId: b.businessId, businessName: b.businessName, category: "escalated" })
                                  }
                                >
                                  {b.escalated}
                                </button>
                              ) : (
                                b.escalated
                              )}
                            </TableCell>
                            <TableCell>
                              {b.flagged > 0 ? (
                                <button
                                  type="button"
                                  className="underline decoration-dotted decoration-ink-soft hover:text-ink"
                                  onClick={() =>
                                    setDrill({ businessId: b.businessId, businessName: b.businessName, category: "flagged" })
                                  }
                                >
                                  {b.flagged}
                                </button>
                              ) : (
                                b.flagged
                              )}
                            </TableCell>
                            <TableCell>{b.negativeFeedback}</TableCell>
                            <TableCell>{formatMs(b.medianLatencyMs)}</TableCell>
                            <TableCell>{formatCostUsd(b.costUsd ?? 0)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="flex flex-col gap-2 lg:hidden">
                    {data.perBusiness.map((b: any) => (
                      <div key={b.businessId} className="rounded-lg border border-border bg-bg-2 p-3">
                        <div className="font-semibold text-ink">{b.businessName}</div>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <div className="text-ink-soft">Respostas</div>
                            <div className="text-ink">{b.total}</div>
                          </div>
                          <div>
                            <div className="text-ink-soft">Silêncio</div>
                            <div className="text-ink">
                              {b.abstained > 0 ? (
                                <button
                                  type="button"
                                  className="underline decoration-dotted decoration-ink-soft"
                                  onClick={() =>
                                    setDrill({ businessId: b.businessId, businessName: b.businessName, category: "model_abstained" })
                                  }
                                >
                                  {b.abstained}
                                </button>
                              ) : (
                                b.abstained
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="text-ink-soft">Escalado</div>
                            <div className="text-ink">
                              {b.escalated > 0 ? (
                                <button
                                  type="button"
                                  className="underline decoration-dotted decoration-ink-soft"
                                  onClick={() =>
                                    setDrill({ businessId: b.businessId, businessName: b.businessName, category: "escalated" })
                                  }
                                >
                                  {b.escalated}
                                </button>
                              ) : (
                                b.escalated
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="text-ink-soft">Sinalizado</div>
                            <div className="text-ink">
                              {b.flagged > 0 ? (
                                <button
                                  type="button"
                                  className="underline decoration-dotted decoration-ink-soft"
                                  onClick={() =>
                                    setDrill({ businessId: b.businessId, businessName: b.businessName, category: "flagged" })
                                  }
                                >
                                  {b.flagged}
                                </button>
                              ) : (
                                b.flagged
                              )}
                            </div>
                          </div>
                          <div>
                            <div className="text-ink-soft">Feedback negativo</div>
                            <div className="text-ink">{b.negativeFeedback}</div>
                          </div>
                          <div>
                            <div className="text-ink-soft">Mediana resposta</div>
                            <div className="text-ink">{formatMs(b.medianLatencyMs)}</div>
                          </div>
                          <div>
                            <div className="text-ink-soft">Custo estimado</div>
                            <div className="text-ink">{formatCostUsd(b.costUsd ?? 0)}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <ProblemCasesDrawer
        open={drill !== null}
        onClose={() => setDrill(null)}
        businessId={drill?.businessId}
        businessName={drill?.businessName}
        category={drill?.category}
        days={Number(range)}
      />
    </div>
  );
}
