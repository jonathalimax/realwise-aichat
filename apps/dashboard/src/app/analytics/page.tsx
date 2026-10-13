"use client";

import { useEffect, useState } from "react";
import { resolvePlanFeatures } from "@realwise/shared";
import { getTopQuestions, getAnalyticsSummary, getAdvancedAnalytics, getMe } from "../../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../../components/ui/table";
import { LockedSection } from "../../components/LockedSection";

export default function AnalyticsPage() {
  const [questions, setQuestions] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [hasFullAnalytics, setHasFullAnalytics] = useState(false);
  const [advanced, setAdvanced] = useState<any>(null);

  useEffect(() => {
    getTopQuestions().then(setQuestions).catch(() => setQuestions([]));
    getAnalyticsSummary().then(setSummary).catch(() => setSummary(null));
    getMe()
      .then((business) => setHasFullAnalytics(resolvePlanFeatures(business?.subscription?.plan ?? null).analytics === "full"))
      .catch(() => setHasFullAnalytics(false));
    getAdvancedAnalytics().then(setAdvanced).catch(() => setAdvanced(null));
  }, []);

  const responseTime = advanced?.responseTime;
  const topListings = advanced?.topListings ?? [];
  const leadQuality = advanced?.leadQuality ?? [];
  const funnel = advanced?.funnel;
  const escalationReasons = advanced?.escalationReasons ?? [];

  const premiumContent = (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Tempo de resposta</CardTitle>
          <CardDescription>Percentis de latência da Clara nos últimos 30 dias.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {responseTime ? (
            <div className="flex gap-6 text-sm text-ink">
              <div><span className="text-ink-soft">p50</span> {responseTime.p50}ms</div>
              <div><span className="text-ink-soft">p90</span> {responseTime.p90}ms</div>
              <div><span className="text-ink-soft">p99</span> {responseTime.p99}ms</div>
            </div>
          ) : (
            <div className="rounded-card border border-border px-4 py-8 text-center text-sm text-ink-soft">Ainda sem dados suficientes.</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Qualidade dos leads</CardTitle>
          <CardDescription>Distribuição por faixa de score de comprometimento.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {leadQuality.length > 0 ? (
            <div className="flex flex-col gap-2">
              {leadQuality.map((l: any) => (
                <div key={l.scoreBand} className="flex items-center justify-between text-sm text-ink">
                  <span className="capitalize">{l.scoreBand}</span>
                  <span className="text-ink-soft">{l.count} leads · score médio {l.avgCommitmentScore?.toFixed?.(0) ?? "—"}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-card border border-border px-4 py-8 text-center text-sm text-ink-soft">Ainda sem dados suficientes.</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Imóveis/veículos mais procurados</CardTitle>
          <CardDescription>Itens mais mencionados em conversas nos últimos 30 dias.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {topListings.length > 0 ? (
            <div className="flex flex-col gap-2">
              {topListings.map((l: any) => (
                <div key={l.id} className="flex items-center justify-between text-sm text-ink">
                  <span>{l.title}</span>
                  <span className="text-ink-soft">{l.mentions} menções</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-card border border-border px-4 py-8 text-center text-sm text-ink-soft">Ainda sem dados suficientes.</div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Funil e motivos de escalonamento</CardTitle>
          <CardDescription>Conversas que viraram agendamento ou foram escalonadas para a equipe.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {funnel ? (
            <div className="flex flex-col gap-2 text-sm text-ink">
              <div>{funnel.conversations} conversas → {funnel.appointments} agendamentos → {funnel.escalated} escalonadas</div>
              {escalationReasons.length > 0 ? (
                escalationReasons.map((r: any) => (
                  <div key={r.reason} className="flex items-center justify-between text-ink-soft">
                    <span>{r.reason}</span>
                    <span>{r.count}</span>
                  </div>
                ))
              ) : (
                <div className="text-ink-soft">Ainda sem motivos registrados.</div>
              )}
            </div>
          ) : (
            <div className="rounded-card border border-border px-4 py-8 text-center text-sm text-ink-soft">Ainda sem dados suficientes.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );

  return (
    <div>
      <h1 className="mb-5 font-serif text-2xl text-ink">Análises</h1>

      <div className="mb-4">
        <Card>
          <CardHeader>
            <CardTitle>Conversas nos últimos 7 dias</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 text-2xl font-mono tabular-nums text-ink">
            {summary?.conversations7d ?? "—"}
          </CardContent>
        </Card>
      </div>

      <div className="mb-6">{hasFullAnalytics ? premiumContent : <LockedSection>{premiumContent}</LockedSection>}</div>

      <Card>
        <CardHeader>
          <CardTitle>Perguntas sem resposta</CardTitle>
          <CardDescription>Perguntas que a Clara não conseguiu responder, mais repetidas primeiro — ótimo ponto de partida para completar sua base de conhecimento.</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {questions.length === 0 ? (
            <div className="rounded-card border border-border px-4 py-8 text-center text-sm text-ink-soft">
              Ainda sem dados suficientes.
            </div>
          ) : (
            <>
              <div className="hidden lg:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pergunta</TableHead>
                      <TableHead className="text-right">Ocorrências</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {questions.map((q) => (
                      <TableRow key={q.id}>
                        <TableCell>{q.questionText}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">{q.occurrenceCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="flex flex-col gap-2 lg:hidden">
                {questions.map((q) => (
                  <div key={q.id} className="rounded-lg border border-border bg-bg-2 p-3">
                    <div className="text-sm text-ink">{q.questionText}</div>
                    <div className="mt-2 text-xs text-ink-soft">Ocorrências: {q.occurrenceCount}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
