"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import tokens from "../../../../../packages/ui/tokens.json";

const light = tokens.color.light;

interface Bucket {
  range: string;
  count: number;
}

const COLORS = [light.negative, light.warning, light.warning, light.accent, light.positive];

export function ConfidenceDistributionChart({ data }: { data: Bucket[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={light.border} vertical={false} />
        <XAxis dataKey="range" tick={{ fontSize: 11, fill: light.inkMuted }} axisLine={{ stroke: light.border }} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: light.inkMuted }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{ background: light.surface, border: `1px solid ${light.border}`, borderRadius: 12, fontSize: 12 }}
          cursor={{ fill: light.bgCanvasInset }}
        />
        <Bar dataKey="count" name="Negócios" radius={[6, 6, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i] ?? light.accent} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
