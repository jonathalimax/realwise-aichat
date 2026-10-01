"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import tokens from "../../../../../packages/ui/tokens.json";

const light = tokens.color.light;

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
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <defs>
          <linearGradient id="convFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={light.accent} stopOpacity={0.35} />
            <stop offset="95%" stopColor={light.accent} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="leadsFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={light.limeInk} stopOpacity={0.4} />
            <stop offset="95%" stopColor={light.limeInk} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="apptFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={light.warning} stopOpacity={0.4} />
            <stop offset="95%" stopColor={light.warning} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="linkFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={light.inkMuted} stopOpacity={0.3} />
            <stop offset="95%" stopColor={light.inkMuted} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={light.border} vertical={false} />
        <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 11, fill: light.inkMuted }} axisLine={{ stroke: light.border }} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: light.inkMuted }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{ background: light.surface, border: `1px solid ${light.border}`, borderRadius: 12, fontSize: 12 }}
          labelFormatter={(label) => formatDate(String(label))}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area type="monotone" dataKey="conversations" name="Conversas" stroke={light.accent} strokeWidth={2} fill="url(#convFill)" />
        <Area type="monotone" dataKey="leads" name="Leads" stroke={light.limeInk} strokeWidth={2} fill="url(#leadsFill)" />
        <Area type="monotone" dataKey="appointments" name="Agendamentos" stroke={light.warning} strokeWidth={2} fill="url(#apptFill)" />
        <Area type="monotone" dataKey="linkOpens" name="Aberturas do link" stroke={light.inkMuted} strokeWidth={2} fill="url(#linkFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
