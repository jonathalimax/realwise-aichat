export function KpiCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-card border border-border bg-surface px-4 py-3">
      <div className="text-[0.7rem] uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 font-mono text-xl text-ink">{value}</div>
    </div>
  );
}
