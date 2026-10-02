"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ChartTooltipContent } from "./ChartTooltipContent";

const LABELS: Record<string, string> = {
  coverage: "Campos obrigatórios",
  documentDepth: "Profundidade de documentos",
  answerAbility: "Capacidade de resposta",
  realWorldFit: "Aderência real",
  ownerReview: "Revisão do dono",
};

export function ConfidenceBreakdownChart({ breakdown }: { breakdown: Record<string, number> }) {
  const data = Object.entries(breakdown)
    .filter(([key]) => LABELS[key])
    .map(([key, value]) => ({ label: LABELS[key], value: Math.round(value * 100) }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: "rgb(var(--muted))" }} axisLine={{ stroke: "rgb(var(--border))" }} tickLine={false} />
        <YAxis type="category" dataKey="label" width={160} tick={{ fontSize: 11, fill: "rgb(var(--ink))" }} axisLine={false} tickLine={false} />
        <Tooltip content={<ChartTooltipContent valueFormatter={(value) => `${value}%`} />} />
        <Bar dataKey="value" name="Valor" fill="rgb(var(--accent))" radius={[0, 6, 6, 0]} barSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}
