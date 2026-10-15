"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";

const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

type FocusRef = MutableRefObject<HTMLElement | null>;
const FocusReturnContext = createContext<FocusRef | null>(null);

/**
 * Remembers which element had focus when a (controlled) dialog/sheet opened, so closing it returns focus there.
 * Radix only does this by itself when the dialog was opened through its own <Trigger>; here dialogs are opened
 * from table rows and buttons, so without this the focus would be lost to <body> after Esc / Cancel.
 */
export function useFocusReturnProvider(open: boolean | undefined) {
  const ref = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  useIsoLayoutEffect(() => {
    if (open && !wasOpen.current) {
      const el = document.activeElement;
      ref.current = el instanceof HTMLElement && el !== document.body ? el : null;
    }
    wasOpen.current = Boolean(open);
  }, [open]);
  return ref;
}

export const FocusReturnProvider = FocusReturnContext.Provider;

/** Handler for Radix `onCloseAutoFocus`: put focus back on the opener when it is still in the page. */
export function useCloseAutoFocus() {
  const ref = useContext(FocusReturnContext);
  return (event: Event) => {
    const el = ref?.current;
    if (el && document.contains(el)) {
      event.preventDefault();
      el.focus();
      return;
    }
    // The opener is gone (e.g. its row left the list after an approval): park focus on the page content, not <body>.
    const main = document.querySelector<HTMLElement>("main");
    if (main) {
      event.preventDefault();
      main.tabIndex = -1;
      main.focus({ preventScroll: true });
    }
  };
}
