interface TooltipPayloadItem {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string;
}

interface ChartTooltipContentProps {
  active?: boolean;
  label?: string | number;
  payload?: TooltipPayloadItem[];
  labelFormatter?: (label: string | number) => string;
  valueFormatter?: (value: number | string, item: TooltipPayloadItem) => string;
}

export function ChartTooltipContent({ active, label, payload, labelFormatter, valueFormatter }: ChartTooltipContentProps) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-chip border border-border bg-surface px-3 py-2 text-xs shadow-popover">
      {label !== undefined && (
        <div className="mb-1.5 font-semibold text-ink">{labelFormatter ? labelFormatter(label) : label}</div>
      )}
      <div className="flex flex-col gap-1">
        {payload.map((item, i) => (
          <div key={item.dataKey ?? i} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
            <span className="text-ink-soft">{item.name}</span>
            <span className="ml-auto font-semibold tabular-nums text-ink">
              {valueFormatter && item.value !== undefined ? valueFormatter(item.value, item) : item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
