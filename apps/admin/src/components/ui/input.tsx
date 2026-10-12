import { InputHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        // text-base (16px) on mobile prevents iOS Safari's auto-zoom-on-focus; md:text-sm keeps the tighter desktop look.
        "w-full rounded-xl border border-border bg-bg-2 px-3 py-2 text-base text-ink outline-none transition-colors placeholder:text-ink-soft/60 focus:border-ink/40 disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}
