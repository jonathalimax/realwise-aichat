"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";
import { FocusReturnProvider, useCloseAutoFocus, useFocusReturnProvider } from "../../lib/focus-return";

export function Dialog({ children, ...props }: DialogPrimitive.DialogProps) {
  const ref = useFocusReturnProvider(props.open);
  return (
    <FocusReturnProvider value={ref}>
      <DialogPrimitive.Root {...props}>{children}</DialogPrimitive.Root>
    </FocusReturnProvider>
  );
}
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, ...props }: DialogPrimitive.DialogContentProps) {
  const onCloseAutoFocus = useCloseAutoFocus();
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-zinc-950/45" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        onCloseAutoFocus={onCloseAutoFocus}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-xl bg-surface p-6 shadow-[0_12px_40px_rgba(0,0,0,0.2)] outline-none",
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: DialogPrimitive.DialogTitleProps) {
  return <DialogPrimitive.Title className={cn("text-lg font-semibold text-ink", className)} {...props} />;
}

export function DialogDescription({ className, ...props }: DialogPrimitive.DialogDescriptionProps) {
  return <DialogPrimitive.Description className={cn("text-sm text-muted", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-wrap justify-end gap-2", className)} {...props} />;
}
