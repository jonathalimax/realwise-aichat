import { ButtonHTMLAttributes, forwardRef } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg border text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default: "border-accent bg-accent text-white hover:brightness-95",
        outline: "border-border bg-surface text-ink hover:bg-bg-2",
        destructive: "border-red-200 bg-surface text-red-700 hover:bg-red-50",
        ghost: "border-transparent bg-transparent text-ink hover:bg-bg-2",
        link: "h-auto border-transparent bg-transparent p-0 text-accent hover:underline",
      },
      size: {
        default: "h-9 px-3.5 max-md:min-h-11",
        sm: "h-[30px] px-2.5 text-[13px] max-md:min-h-11",
        lg: "h-11 px-5 text-[15px]",
        icon: "h-9 w-9 p-0 max-md:h-11 max-md:w-11",
        pill: "h-12 rounded-pill px-8 text-base",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
