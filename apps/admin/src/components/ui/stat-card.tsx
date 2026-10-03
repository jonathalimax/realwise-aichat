import { ReactNode } from "react";
import { Card, CardHeader, CardTitle, CardAction, CardContent } from "./card";
import { TrendBadge } from "./badge";

export interface StatCardProps {
  label: string;
  value: string | number;
  trend?: number | null;
  trendLine?: string;
  context?: string;
  icon?: ReactNode;
}

export function StatCard({ label, value, trend, trendLine, context, icon }: StatCardProps) {
  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="col-span-2 flex min-w-0 items-center gap-1.5 font-sans text-xs font-medium uppercase tracking-wide leading-tight text-ink-soft sm:col-span-1">
          {icon}
          <span>{label}</span>
        </CardTitle>
        {trend !== undefined && (
          <CardAction className="row-start-2 sm:row-start-1">
            <TrendBadge delta={trend} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="pt-1">
        <div className="text-2xl font-semibold tabular-nums text-ink sm:text-3xl">{value}</div>
        {trendLine && <div className="mt-2 text-sm font-semibold text-ink">{trendLine}</div>}
        {context && <div className="text-xs text-ink-soft">{context}</div>}
      </CardContent>
    </Card>
  );
}
