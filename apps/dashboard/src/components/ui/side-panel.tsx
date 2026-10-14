"use client";

import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./sheet";
import { cn } from "../../lib/utils";

/** Right-hand detail panel (480px). `title` is also the accessible name. */
export function SidePanel({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className={cn("w-full overflow-hidden p-0 sm:w-[480px] sm:max-w-[480px]", className)}>
        <div className="flex h-full flex-col">
          <SheetHeader className="p-6 pb-3">
            <SheetTitle>{title}</SheetTitle>
            {description && <SheetDescription>{description}</SheetDescription>}
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-4">{children}</div>
          {footer && <div className="flex flex-wrap gap-2 border-t border-border px-6 py-4">{footer}</div>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
