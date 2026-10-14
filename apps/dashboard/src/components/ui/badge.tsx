import { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full border border-transparent px-2.5 text-xs font-semibold",
  {
    variants: {
      variant: {
        // legacy names (real-estate pages)
        neutral: "border-border text-ink-soft",
        positive: "bg-positive-soft text-positive",
        negative: "bg-negative-soft text-negative",
        warning: "bg-warning-soft text-warning",
        accent: "bg-accent-soft text-accent-ink",
        secondary: "bg-secondary-soft text-secondary-ink",
        tertiary: "bg-tertiary-soft text-tertiary-ink",
        trendUp: "rounded-pill border-border text-positive",
        trendDown: "rounded-pill border-border text-negative",
        trendFlat: "rounded-pill border-border text-ink-soft",
        // shadcn-like tones (names match the badge strings returned by the pharmacy API)
        default: "bg-accent text-white",
        soft: "bg-brand-soft text-brand-2",
        outline: "border-border bg-surface text-ink",
        red: "bg-red-100 text-red-800",
        amber: "bg-amber-100 text-amber-800",
        green: "bg-green-100 text-green-800",
        gray: "bg-zinc-100 text-zinc-700",
        blue: "bg-blue-100 text-blue-800",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

const TONES = new Set(["default", "soft", "outline", "red", "amber", "green", "gray", "blue"]);
/** Maps the `badge` string returned by the API ("green" | "amber" | ...) to a Badge variant. */
export function toneVariant(tone: string | null | undefined): BadgeVariant {
  return tone && TONES.has(tone) ? (tone as BadgeVariant) : "outline";
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
