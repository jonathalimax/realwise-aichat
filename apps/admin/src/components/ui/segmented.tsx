import { HTMLAttributes, ButtonHTMLAttributes } from "react";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils";

export function Segmented({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="group"
      className={cn("inline-flex gap-0.5 rounded-pill border border-border bg-bg-2 p-0.5", className)}
      {...props}
    />
  );
}

const segmentedItemVariants = cva("rounded-pill px-3 py-1 text-xs font-semibold transition-colors", {
  variants: {
    selected: {
      true: "bg-accent text-white shadow-card",
      false: "text-ink-soft hover:text-ink",
    },
  },
  defaultVariants: { selected: false },
});

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
