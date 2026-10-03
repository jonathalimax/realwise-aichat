"use client";

import { useEffect, useState } from "react";
import { getConversationInsights } from "../../lib/api";
import { StatCard } from "../../components/ui/stat-card";
import { SegmentedControl } from "../../components/ui/segmented";
import { Card, CardHeader, CardTitle, CardContent } from "../../components/ui/card";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../../components/ui/table";

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

export default function ConversationsPage() {
  const [range, setRange] = useState<(typeof RANGE_OPTIONS)[number]["value"]>("7");
  const [data, setData] = useState<any>(null);

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
            <StatCard
              label="Ficou em silêncio"
              value={data.bySource.abstained}
              context={pct(data.abstentionRate)}
            />
            <StatCard
              label="Escalado p/ humano"
              value={data.bySource.escalation}
              context={pct(data.escalationRate)}
            />
            <StatCard label="Tempo de resposta" value={formatMs(data.medianLatencyMs)} context={`mediana · média ${formatMs(data.avgLatencyMs)}`} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Por tipo de resposta</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
            <CardContent>
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
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.perBusiness.map((b: any) => (
                    <TableRow key={b.businessId}>
                      <TableCell>{b.businessName}</TableCell>
                      <TableCell>{b.total}</TableCell>
                      <TableCell>{b.abstained}</TableCell>
                      <TableCell>{b.escalated}</TableCell>
                      <TableCell>{b.flagged}</TableCell>
                      <TableCell>{b.negativeFeedback}</TableCell>
                      <TableCell>{formatMs(b.medianLatencyMs)}</TableCell>
                    </TableRow>
                  ))}
                  {data.perBusiness.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-ink-soft">
                        Nenhuma conversa neste período.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
