"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { ChartTooltipContent } from "./ChartTooltipContent";

interface Bucket {
  range: string;
  count: number;
}

const COLORS = [
  "rgb(var(--negative))",
  "rgb(var(--warning))",
  "rgb(var(--warning))",
  "rgb(var(--accent))",
  "rgb(var(--positive))",
];

export function ConfidenceDistributionChart({ data }: { data: Bucket[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
        <XAxis dataKey="range" tick={{ fontSize: 11, fill: "rgb(var(--muted))" }} axisLine={{ stroke: "rgb(var(--border))" }} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "rgb(var(--muted))" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip content={<ChartTooltipContent />} cursor={{ fill: "rgb(var(--bg-2))" }} />
        <Bar dataKey="count" name="Negócios" radius={[6, 6, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i] ?? "rgb(var(--accent))"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
