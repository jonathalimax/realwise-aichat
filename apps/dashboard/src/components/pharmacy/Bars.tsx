"use client";

import { cn } from "../../lib/utils";

export interface BarDatum {
  label: string;
  /** stacked segments, bottom first */
  segments: { value: number; color: string; name: string }[];
  /** text shown above the bar (optional) */
  top?: string;
}

/** Dependency-free bar chart: stacked segments scale against the tallest bucket. Accessible via aria-label + title. */
export function Bars({ data, height = 190, className, ariaLabel }: { data: BarDatum[]; height?: number; className?: string; ariaLabel: string }) {
  const max = Math.max(1, ...data.map((d) => d.segments.reduce((a, s) => a + s.value, 0)));
  return (
    <div role="img" aria-label={ariaLabel} className={cn("flex items-end gap-2.5", className)} style={{ height: height + 40 }}>
      {data.map((d) => {
        const total = d.segments.reduce((a, s) => a + s.value, 0);
        return (
          <div
            key={d.label}
            className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5"
            title={`${d.label}: ${d.segments.map((s) => `${s.name} ${s.value}`).join(" · ")}`}
          >
            {d.top && <span className="text-xs text-muted">{d.top}</span>}
            <div className="flex w-full max-w-11 flex-col-reverse gap-0.5" style={{ height: `${(total / max) * height}px` }}>
              {d.segments.map((s) =>
                s.value > 0 ? (
                  <div key={s.name} className="min-h-[3px] rounded-t first:rounded-t-none [&:last-child]:rounded-t" style={{ background: s.color, flexGrow: s.value, flexBasis: 0 }} />
                ) : null,
              )}
            </div>
            <span className="text-xs text-muted">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: color }} />
      {label}
    </span>
  );
}
