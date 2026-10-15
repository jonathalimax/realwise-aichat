import { InputHTMLAttributes, forwardRef } from "react";
import { cn } from "../../lib/utils";

export const inputClasses =
  // text-base (16px) on mobile prevents iOS Safari's auto-zoom-on-focus; md:text-sm keeps the tighter desktop look.
  "w-full rounded-lg border border-border bg-surface px-3 text-base text-ink outline-none transition-colors placeholder:text-muted/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 disabled:cursor-not-allowed disabled:bg-bg-2 disabled:opacity-60 md:text-sm";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={cn(inputClasses, "h-9 max-md:h-11", className)} {...props} />;
});
