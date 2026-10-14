import { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { cn } from "../../lib/utils";

// `bare` drops the outer border/radius: use it when the table sits directly inside a <Card>, so the
// first/last cell padding (20px) lines up with the card header text.
export function Table({ className, bare, ...props }: HTMLAttributes<HTMLTableElement> & { bare?: boolean }) {
  return (
    <div className={cn("overflow-x-auto", !bare && "rounded-xl border border-border bg-surface")}>
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}

export function TableHeader({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("border-b border-border", className)} {...props} />;
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={className} {...props} />;
}

export function TableRow({
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & { "data-state"?: "selected" }) {
  return (
    <tr
      className={cn(
        "border-b border-border last:border-0 data-[state=selected]:bg-brand-soft [&[onclick]]:cursor-pointer",
        props.onClick && "cursor-pointer hover:bg-bg-2/70",
        className,
      )}
      {...props}
    />
  );
}

const headCell =
  "h-10 whitespace-nowrap px-3.5 text-left align-middle text-[13px] font-medium text-muted first:pl-5 last:pr-5";

export function TableHead({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn(headCell, className)} {...props} />;
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
    <th className={cn(headCell, className)} {...props}>
      <button type="button" onClick={onClick} className="inline-flex items-center gap-1 hover:text-ink">
        {children}
        <Icon className={cn("h-3 w-3", sorted ? "text-ink" : "text-muted/60")} />
      </button>
    </th>
  );
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3.5 py-3 align-middle first:pl-5 last:pr-5", className)} {...props} />;
}
