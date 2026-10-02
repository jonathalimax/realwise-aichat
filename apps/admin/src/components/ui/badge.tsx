import { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "../../lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.7rem] font-semibold", {
  variants: {
    variant: {
      neutral: "border border-border text-ink-soft",
      positive: "bg-positive-soft text-positive",
      negative: "bg-negative-soft text-negative",
      warning: "bg-warning-soft text-warning",
      accent: "bg-accent-soft text-accent-ink",
      trendUp: "gap-1 rounded-pill border border-border text-positive",
      trendDown: "gap-1 rounded-pill border border-border text-negative",
      trendFlat: "gap-1 rounded-pill border border-border text-ink-soft",
    },
  },
  defaultVariants: { variant: "neutral" },
});

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export function statusToBadgeVariant(status: string): BadgeProps["variant"] {
  switch (status) {
    case "live":
      return "positive";
    case "suspended":
    case "churned":
      return "negative";
    case "pending_review":
      return "warning";
    default:
      return "neutral";
  }
}

export function TrendBadge({ delta }: { delta: number | null }) {
  if (delta === null) {
    return (
      <Badge variant="trendFlat" className="tabular-nums">
        <Minus className="h-3 w-3" />—
      </Badge>
    );
  }
  if (delta === 0) {
    return (
      <Badge variant="trendFlat" className="tabular-nums">
        <Minus className="h-3 w-3" />0%
      </Badge>
    );
  }
  const isUp = delta > 0;
  return (
    <Badge variant={isUp ? "trendUp" : "trendDown"} className="tabular-nums">
      {isUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {isUp ? "+" : ""}
      {delta.toFixed(delta % 1 === 0 ? 0 : 1)}%
    </Badge>
  );
}
