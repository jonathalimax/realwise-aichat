import { ButtonHTMLAttributes, forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 font-semibold transition-colors disabled:opacity-40 disabled:pointer-events-none",
  {
    variants: {
      // [@media(hover:hover)] guards every hover: style so it only applies on devices with a real
      // pointer — on touch (iOS Safari especially), :hover triggers on tap and has no mouseleave
      // to clear it, so a tapped bubble/button stays visually "selected" until the next unrelated
      // tap. Plain `hover:` would make every tap look stuck on mobile, which is the entire chat UI.
      variant: {
        default: "rounded-lg bg-accent text-white [@media(hover:hover)]:hover:opacity-90",
        outline: "rounded-lg border border-border text-ink-soft [@media(hover:hover)]:hover:bg-bg-2",
        ghost: "rounded-lg text-ink-soft [@media(hover:hover)]:hover:bg-bg-2",
        round: "rounded-full bg-accent text-white [@media(hover:hover)]:hover:opacity-90",
      },
      size: {
        default: "h-9 px-4 text-sm",
        sm: "h-8 px-3 text-xs",
        icon: "h-10 w-10 flex-none",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, ...props },
  ref,
) {
  return <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
