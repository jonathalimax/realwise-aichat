"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, ArrowRight, Snowflake, HelpCircle, Clock, TrendingUp, CheckCircle2 } from "lucide-react";
import { getAnalyticsSummary, getAnalyticsTimeseries, getAnalyticsInsights, getMe } from "../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { StatCard } from "../components/ui/stat-card";
import { SegmentedControl } from "../components/ui/segmented";
import { ActivityChart } from "../components/charts/ActivityChart";
import { ShareLink } from "../components/ShareLink";
import { InsightCard } from "../components/InsightCard";

const STATS = [
  { key: "conversations7d", label: "Conversas 7d" },
  { key: "leadsTotal", label: "Leads" },
  { key: "appointmentsTotal", label: "Agendamentos" },
  { key: "linkOpens7d", label: "Aberturas do link 7d" },
] as const;

const RANGE_OPTIONS = [
  { label: "Últimos 7 dias", value: "7" },
  { label: "Últimos 30 dias", value: "30" },
  { label: "Últimos 3 meses", value: "90" },
] as const;

function percentDelta(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? null : 100;
  return ((current - previous) / previous) * 100;
}

export default function HomePage() {
  const router = useRouter();
  const [business, setBusiness] = useState<any>(null);
  const [summary, setSummary] = useState<any>(null);
  const [timeseries, setTimeseries] = useState<any[]>([]);
  const [range, setRange] = useState<"7" | "30" | "90">("30");
  const [question, setQuestion] = useState("");
  const [insights, setInsights] = useState<any>(null);

  function handleAskClara() {
    if (!question.trim()) return;
    router.push(`/assistant?q=${encodeURIComponent(question.trim())}`);
  }

  useEffect(() => {
    getMe().then(setBusiness).catch(() => {});
    getAnalyticsSummary().then(setSummary).catch(() => {});
    getAnalyticsInsights().then(setInsights).catch(() => {});
  }, []);

  useEffect(() => {
    getAnalyticsTimeseries(Number(range)).then(setTimeseries).catch(() => setTimeseries([]));
  }, [range]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl text-ink">{business?.name ?? "Seu negócio"}</h1>
        <Badge variant="accent" className="px-3 py-1.5 text-sm">
          Prontidão: <span className="ml-1 font-mono font-bold">{business?.confidenceScore ?? 0}%</span>
        </Badge>
      </div>
      <Card className="border-accent/30 bg-accent/5">
        <CardContent className="flex flex-col gap-3 pt-6 md:flex-row md:items-center">
          <div className="flex items-center gap-2 text-accent">
            <Sparkles className="h-5 w-5 flex-none" />
            <span className="hidden text-sm font-semibold md:inline">Clara</span>
          </div>
          <Input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAskClara()}
            placeholder="Pergunte à Clara sobre seu negócio… (ex: quantos leads quentes eu tenho?)"
            className="flex-1"
          />
          <Button onClick={handleAskClara} disabled={!question.trim()} className="gap-1">
            Perguntar <ArrowRight className="h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
      {business?.status === "live" && <ShareLink slug={business.slug} />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {STATS.map(({ key, label }) => (
          <StatCard
            key={key}
            label={label}
            value={summary?.[key] ?? "—"}
            trend={summary ? percentDelta(summary[key] ?? 0, summary.previous?.[key] ?? 0) : undefined}
          />
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Atividade</CardTitle>
          <CardAction>
            <SegmentedControl value={range} onValueChange={setRange} options={RANGE_OPTIONS} />
          </CardAction>
          <CardDescription>Conversas e leads novos por dia.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityChart data={timeseries} />
        </CardContent>
      </Card>
      {insights && (
        <div className="flex flex-col gap-3">
          <h2 className="font-serif text-lg text-ink">Insights</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {insights.coolingLeads.count > 0 ? (
              <InsightCard
                icon={<Snowflake className="h-5 w-5" />}
                headline={`${insights.coolingLeads.count} ${insights.coolingLeads.count === 1 ? "lead esfriando" : "leads esfriando"}`}
                description="Quentes ou mornos, sumidos há mais de 24h e sem agendamento ou retorno registrado — vale um contato direto."
                ctaLabel="Ver leads esfriando"
                ctaHref={`/leads?ids=${insights.coolingLeads.leadIds.join(",")}`}
              />
            ) : (
              <InsightCard
                icon={<CheckCircle2 className="h-5 w-5" />}
                headline="Nenhum lead esfriando agora"
                description="Todos os leads quentes e mornos seguem com acompanhamento em dia. Ótimo trabalho!"
              />
            )}

            {insights.topUnansweredQuestion ? (
              <InsightCard
                icon={<HelpCircle className="h-5 w-5" />}
                headline={`"${insights.topUnansweredQuestion.questionText}"`}
                description={`${insights.topUnansweredQuestion.occurrenceCount} ${insights.topUnansweredQuestion.occurrenceCount === 1 ? "cliente perguntou" : "clientes perguntaram"} isso e não teve resposta — considere adicionar aos documentos.`}
                ctaLabel="Ir para Base de conhecimento"
                ctaHref="/knowledge"
              />
            ) : (
              <InsightCard
                icon={<CheckCircle2 className="h-5 w-5" />}
                headline="Nenhuma pergunta sem resposta"
                description="A Clara está conseguindo responder tudo com a base de conhecimento atual."
              />
            )}

            {insights.peakHour ? (
              <InsightCard
                icon={<Clock className="h-5 w-5" />}
                headline={`Seu horário de mais tráfego é ${insights.peakHour.weekday}, ${insights.peakHour.hourRange}`}
                description={
                  insights.peakHour.isOutsideBusinessHours
                    ? "Fora do horário comercial — a Clara está cobrindo esse público pra você."
                    : "A Clara está cobrindo esse pico de atendimento pra você."
                }
              />
            ) : (
              <InsightCard
                icon={<Clock className="h-5 w-5" />}
                headline="Ainda sem dados suficientes de horário"
                description="Assim que houver mais conversas, mostramos aqui seu horário de pico de tráfego."
              />
            )}

            {insights.conversionFunnel && (
              <InsightCard
                icon={<TrendingUp className="h-5 w-5" />}
                headline={`${insights.conversionFunnel.conversations} conversas viraram ${insights.conversionFunnel.appointments} agendamentos esta semana`}
                description={
                  insights.conversionFunnel.prevRate !== null
                    ? `Taxa de conversão de ${(insights.conversionFunnel.rate * 100).toFixed(0)}%, ${
                        insights.conversionFunnel.rate >= insights.conversionFunnel.prevRate ? "acima" : "abaixo"
                      } da semana anterior (${(insights.conversionFunnel.prevRate * 100).toFixed(0)}%).`
                    : `Taxa de conversão de ${(insights.conversionFunnel.rate * 100).toFixed(0)}% nesta semana.`
                }
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
