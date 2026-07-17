import { clsx } from "clsx";
import type { ComponentProps, ReactNode } from "react";

export function Button({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      className={clsx(
        "inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-emerald-200 disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={clsx("rounded-2xl border border-slate-200 bg-white p-5 shadow-sm", className)} {...props} />;
}

export function StatusBadge({ status }: { status: "ok" | "warning" | "danger" | "neutral" }) {
  const copy = {
    ok: "Saudável",
    warning: "Ação necessária",
    danger: "Interrompido",
    neutral: "Planejado",
  }[status];
  return (
    <span
      className={clsx(
        "inline-flex rounded-full px-3 py-1 text-xs font-semibold",
        status === "ok" && "bg-emerald-100 text-emerald-800",
        status === "warning" && "bg-amber-100 text-amber-800",
        status === "danger" && "bg-rose-100 text-rose-800",
        status === "neutral" && "bg-slate-100 text-slate-700",
      )}
    >
      {copy}
    </span>
  );
}

export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
      <h3 className="text-lg font-semibold text-slate-950">{title}</h3>
      <p className="mt-2 text-sm text-slate-600">{children}</p>
    </div>
  );
}

export function UsageMeter({ used, limit }: { used: number; limit: number }) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div aria-label={`${used} de ${limit} mensagens usadas`}>
      <div className="flex justify-between text-sm text-slate-600">
        <span>Uso de mensagens</span>
        <span>{used}/{limit}</span>
      </div>
      <div className="mt-2 h-3 rounded-full bg-slate-100">
        <div className="h-3 rounded-full bg-emerald-600" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
