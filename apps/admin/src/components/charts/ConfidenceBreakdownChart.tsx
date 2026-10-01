"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import tokens from "../../../../../packages/ui/tokens.json";

const light = tokens.color.light;

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
        <CartesianGrid strokeDasharray="3 3" stroke={light.border} horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: light.inkMuted }} axisLine={{ stroke: light.border }} tickLine={false} />
        <YAxis type="category" dataKey="label" width={160} tick={{ fontSize: 11, fill: light.ink }} axisLine={false} tickLine={false} />
        <Tooltip
          contentStyle={{ background: light.surface, border: `1px solid ${light.border}`, borderRadius: 12, fontSize: 12 }}
          formatter={(value) => [`${value}%`, "Valor"]}
        />
        <Bar dataKey="value" fill={light.accent} radius={[0, 6, 6, 0]} barSize={18} />
      </BarChart>
    </ResponsiveContainer>
  );
}
