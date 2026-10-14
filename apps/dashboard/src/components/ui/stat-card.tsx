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
        <CardTitle className="flex min-w-0 items-center gap-1.5 whitespace-normal font-sans text-xs font-medium uppercase leading-tight tracking-wide text-ink-soft">
          {icon && <span className="shrink-0">{icon}</span>}
          <span className="min-w-0">{label}</span>
        </CardTitle>
        {trend !== undefined && (
          <CardAction className="col-start-2 row-start-1 justify-self-end">
            <TrendBadge delta={trend} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="pt-1">
        <div className="text-3xl font-semibold tabular-nums text-ink">{value}</div>
        {trendLine && <div className="mt-2 text-sm font-semibold text-ink">{trendLine}</div>}
        {context && <div className="text-xs text-ink-soft">{context}</div>}
      </CardContent>
    </Card>
  );
}

// KPI tile used by the pharmacy dashboards: small label, big number, muted note.
export function KpiCard({ label, value, note }: { label: string; value: ReactNode; note?: string | null }) {
  return (
    <Card className="px-5 py-4">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="my-1.5 text-[28px] font-bold leading-[1.1] tracking-tight text-ink tabular-nums">{value}</div>
      {note && <div className="text-xs text-muted">{note}</div>}
    </Card>
  );
}
