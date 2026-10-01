"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;

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
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
      <Dialog.Content
        className={cn(
          "fixed inset-y-0 z-50 flex w-72 flex-col bg-bg-2 shadow-xl outline-none",
          side === "left" ? "left-0" : "right-0",
          className,
        )}
      >
        <Dialog.Close className="absolute right-3 top-3 rounded-lg p-1.5 text-ink-soft hover:bg-surface">
          <X className="h-5 w-5" />
          <span className="sr-only">Fechar</span>
        </Dialog.Close>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
