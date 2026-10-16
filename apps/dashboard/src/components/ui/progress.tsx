import { cn } from "../../lib/utils";

export function Progress({ value, className, color }: { value: number; className?: string; color?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-2 overflow-hidden rounded-full bg-bg-2", className)}
    >
      <i className="block h-full rounded-full bg-accent" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
