import { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("overflow-hidden rounded-card border border-border bg-surface shadow-card", className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 items-start gap-1 p-4 pb-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-6 sm:pb-2",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("min-w-0 break-words font-serif text-base text-ink", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("col-span-2 text-xs text-ink-soft", className)} {...props} />;
}

export function CardAction({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "col-start-1 row-start-2 justify-self-start sm:col-start-2 sm:row-start-1 sm:justify-self-end",
        className,
      )}
      {...props}
    />
  );
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 pt-0 sm:p-6 sm:pt-0", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-center p-4 pt-0 sm:p-6 sm:pt-0", className)} {...props} />;
}
