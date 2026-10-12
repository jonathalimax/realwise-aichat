import { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { cn } from "../../lib/utils";

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto rounded-card border border-border">
      <table className={cn("w-full text-sm", className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("border-b border-border bg-bg-2", className)} {...props} />;
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement> & { "data-state"?: "selected" }) {
  return (
    <tr
      className={cn("border-b border-border/60 last:border-0 hover:bg-bg-2/60 data-[state=selected]:bg-bg-2", className)}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("px-2 pb-2 pt-1 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-ink-soft", className)} {...props} />;
}

type SortDirection = "asc" | "desc" | false;

export function SortableTableHead({
  className,
  children,
  sorted,
  onClick,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & { sorted?: SortDirection; onClick?: () => void }) {
  const Icon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <th className={cn("px-2 pb-2 pt-1 text-left text-[0.7rem] font-semibold uppercase tracking-wide text-ink-soft", className)} {...props}>
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1 hover:text-ink">
        {children}
        <Icon className={cn("h-3 w-3", sorted ? "text-ink" : "text-ink-soft/60")} />
      </button>
    </th>
  );
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-2 py-3", className)} {...props} />;
}
