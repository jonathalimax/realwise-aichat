import { InputHTMLAttributes, forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const inputVariants = cva(
  // text-base (16px) on mobile prevents iOS Safari's auto-zoom-on-focus; md:text-sm keeps the tighter desktop look.
  "w-full border border-border bg-surface text-base text-ink outline-none transition-colors placeholder:text-ink-soft focus:border-ink/40 disabled:opacity-50 md:text-sm",
  {
    variants: {
      variant: {
        default: "rounded-lg px-3 py-2",
        pill: "rounded-full px-4 py-2.5",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface InputProps extends InputHTMLAttributes<HTMLInputElement>, VariantProps<typeof inputVariants> {}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, variant, ...props }, ref) {
  return <input ref={ref} className={cn(inputVariants({ variant }), className)} {...props} />;
});
