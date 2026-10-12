"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { ChartTooltipContent } from "./ChartTooltipContent";

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
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="conversationsFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="rgb(var(--accent))" stopOpacity={0.35} />
            <stop offset="95%" stopColor="rgb(var(--accent))" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={formatDate}
          tick={{ fontSize: 11, fill: "rgb(var(--muted))" }}
          axisLine={{ stroke: "rgb(var(--border))" }}
          tickLine={false}
        />
        <YAxis tick={{ fontSize: 11, fill: "rgb(var(--muted))" }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip content={<ChartTooltipContent labelFormatter={(label) => formatDate(String(label))} />} />
        <Area
          type="natural"
          dataKey="conversations"
          name="Conversas"
          stroke="rgb(var(--accent))"
          strokeWidth={2}
          fill="url(#conversationsFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
