"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

export function SheetContent({
  children,
  className,
  side = "left",
}: {
  children: React.ReactNode;
  className?: string;
  side?: "left" | "right";
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-zinc-950/45" />
      <Dialog.Content
        aria-describedby={undefined}
        className={cn(
          "fixed inset-y-0 z-50 flex w-72 flex-col bg-surface shadow-[0_0_24px_rgba(0,0,0,0.18)] outline-none",
          side === "left" ? "left-0" : "right-0",
          className,
        )}
      >
        <Dialog.Close className="absolute right-3 top-3 rounded-lg p-1.5 text-muted hover:bg-bg-2 hover:text-ink">
          <X className="h-5 w-5" />
          <span className="sr-only">Fechar</span>
        </Dialog.Close>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}

export function SheetHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 pr-8", className)} {...props} />;
}

export function SheetTitle({ className, ...props }: React.ComponentProps<typeof Dialog.Title>) {
  return <Dialog.Title className={cn("text-xl font-semibold text-ink", className)} {...props} />;
}

export function SheetDescription({ className, ...props }: React.ComponentProps<typeof Dialog.Description>) {
  return <Dialog.Description className={cn("text-xs text-muted", className)} {...props} />;
}
