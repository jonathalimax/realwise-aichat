import { HTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const alertVariants = cva("flex gap-2.5 rounded-[10px] border px-3.5 py-3 text-[13px]", {
  variants: {
    variant: {
      default: "border-border bg-surface text-ink",
      soft: "border-accent/30 bg-brand-soft text-brand-2",
      amber: "border-amber-200 bg-amber-50 text-amber-900",
      red: "border-red-200 bg-red-50 text-red-900",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, "title">, VariantProps<typeof alertVariants> {
  title?: ReactNode;
  action?: ReactNode;
}

export function Alert({ className, variant, title, action, children, ...props }: AlertProps) {
  return (
    <div role={variant === "red" ? "alert" : "status"} className={cn(alertVariants({ variant }), "items-center justify-between flex-wrap", className)} {...props}>
      <div className="min-w-0 flex-1">
        {title && <div className="font-semibold">{title}</div>}
        <div>{children}</div>
      </div>
      {action}
    </div>
  );
}
