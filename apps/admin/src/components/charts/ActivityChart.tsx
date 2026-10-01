"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import tokens from "../../../../../packages/ui/tokens.json";

const light = tokens.color.light;

interface Point {
  date: string;
  conversations: number;
  tokens: number;
}

function formatDate(date: string) {
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function ActivityChart({ data }: { data: Point[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="conversationsFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={light.accent} stopOpacity={0.35} />
            <stop offset="95%" stopColor={light.accent} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={light.border} vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tick={{ fontSize: 11, fill: light.inkMuted }}
          axisLine={{ stroke: light.border }}
          tickLine={false}
        />
        <YAxis tick={{ fontSize: 11, fill: light.inkMuted }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{ background: light.surface, border: `1px solid ${light.border}`, borderRadius: 12, fontSize: 12 }}
          labelFormatter={(label) => formatDate(String(label))}
        />
        <Area
          type="monotone"
          dataKey="conversations"
          name="Conversas"
          stroke={light.accent}
          strokeWidth={2}
          fill="url(#conversationsFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
