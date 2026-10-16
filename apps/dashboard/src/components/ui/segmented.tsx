import { HTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils";

// Muted tray with a white "raised" active item (shadcn Tabs look).
export function Segmented({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="group"
      className={cn("inline-flex max-w-full flex-wrap gap-0.5 rounded-[10px] bg-bg-2 p-1", className)}
      {...props}
    />
  );
}

const segmentedItemVariants = cva(
  "inline-flex h-[30px] max-md:h-11 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent",
  {
    variants: {
      selected: {
        true: "bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]",
        false: "text-muted hover:text-ink",
      },
    },
    defaultVariants: { selected: false },
  },
);

export interface SegmentedItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

export function SegmentedItem({ className, selected, ...props }: SegmentedItemProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(segmentedItemVariants({ selected: Boolean(selected) }), className)}
      {...props}
    />
  );
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly { label: string; value: T }[];
  className?: string;
}

export function SegmentedControl<T extends string>({ value, onValueChange, options, className }: SegmentedControlProps<T>) {
  return (
    <Segmented className={className}>
      {options.map((option) => (
        <SegmentedItem key={option.value} selected={option.value === value} onClick={() => onValueChange(option.value)}>
          {option.label}
        </SegmentedItem>
      ))}
    </Segmented>
  );
}

// ---- Tabs (role=tablist) built on the same look; `count` renders the small muted number ----

export interface TabOption<T extends string> {
  value: T;
  label: string;
  count?: number | null;
  badge?: ReactNode;
}

export function Tabs<T extends string>({
  value,
  onValueChange,
  options,
  className,
  label,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly TabOption<T>[];
  className?: string;
  label?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("inline-flex max-w-full flex-wrap gap-0.5 rounded-[10px] bg-bg-2 p-1", className)}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onValueChange(o.value)}
            className={segmentedItemVariants({ selected })}
          >
            {o.label}
            {typeof o.count === "number" && <span className="text-xs text-muted">{o.count}</span>}
            {o.badge}
          </button>
        );
      })}
    </div>
  );
}
