"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { ChartTooltipContent } from "./ChartTooltipContent";

interface Point {
  date: string;
  conversations: number;
  leads: number;
  appointments: number;
  linkOpens: number;
}

function formatDate(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function ActivityChart({ data }: { data: Point[] }) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="convFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="rgb(var(--accent))" stopOpacity={0.35} />
            <stop offset="95%" stopColor="rgb(var(--accent))" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="leadsFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="rgb(var(--tertiary))" stopOpacity={0.4} />
            <stop offset="95%" stopColor="rgb(var(--tertiary))" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="apptFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="rgb(var(--warning))" stopOpacity={0.4} />
            <stop offset="95%" stopColor="rgb(var(--warning))" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="linkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="rgb(var(--secondary))" stopOpacity={0.35} />
            <stop offset="95%" stopColor="rgb(var(--secondary))" stopOpacity={0.02} />
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
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area type="natural" dataKey="conversations" name="Conversas" stroke="rgb(var(--accent))" strokeWidth={2} fill="url(#convFill)" />
        <Area type="natural" dataKey="leads" name="Leads" stroke="rgb(var(--tertiary))" strokeWidth={2} fill="url(#leadsFill)" />
        <Area type="natural" dataKey="appointments" name="Agendamentos" stroke="rgb(var(--warning))" strokeWidth={2} fill="url(#apptFill)" />
        <Area type="natural" dataKey="linkOpens" name="Aberturas do link" stroke="rgb(var(--secondary))" strokeWidth={2} fill="url(#linkFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
