"use client";

import { useEffect, useRef, useState } from "react";

export interface Listing {
  title: string;
  price?: string;
  description?: string;
  url?: string;
  imageUrl?: string;
}

// listing.url/imageUrl come from LLM-parsed JSON, not from code we control — only ever render
// them if they're a genuine http(s) URL, since a malformed/adversarial model response could
// otherwise produce a javascript: href or similar.
export function safeHttpUrl(u?: string): string | undefined {
  if (!u) return undefined;
  try {
    const parsed = new URL(u);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

// In-app bottom sheet for a listing's full detail + its real page in an iframe, so tapping
// "Ver anúncio" never switches tabs away from the chat. There is no reliable way to detect
// X-Frame-Options/CSP blocking from the client, so the structured detail block is always
// rendered first (useful on its own) and the "Abrir em nova aba" escape hatch is always
// available regardless of iframe state.
export function ListingDetailOverlay({ listing, onClose }: { listing: Listing; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [showSlowHint, setShowSlowHint] = useState(false);
  const touchStartYRef = useRef<number | null>(null);

  const imageUrl = safeHttpUrl(listing.imageUrl);
  const url = safeHttpUrl(listing.url);
  const isHttp = (() => {
    try {
      return url ? new URL(url).protocol === "http:" : false;
    } catch {
      return false;
    }
  })();
  const canEmbed = Boolean(url) && !isHttp;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!canEmbed || iframeLoaded) return;
    const timer = setTimeout(() => setShowSlowHint(true), 3500);
    return () => clearTimeout(timer);
  }, [canEmbed, iframeLoaded]);

  function handleTouchStart(e: React.TouchEvent) {
    touchStartYRef.current = e.touches[0]?.clientY ?? null;
  }
  function handleTouchEnd(e: React.TouchEvent) {
    const startY = touchStartYRef.current;
    touchStartYRef.current = null;
    if (startY == null) return;
    const endY = e.changedTouches[0]?.clientY ?? startY;
    if (endY - startY > 80) onClose();
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        className={`fixed inset-x-0 bottom-0 z-50 flex h-[92dvh] flex-col rounded-t-card bg-bg transition-transform duration-300 ${
          mounted ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div
          className="flex-none border-b border-border px-4 pb-3 pt-2"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
          <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-border" />
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <div className="truncate text-sm font-semibold text-ink">{listing.title}</div>
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-accent underline"
                >
                  Abrir em nova aba
                </a>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar"
              className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-surface text-ink"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="p-4">
            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt={listing.title} className="mb-3 h-48 w-full rounded-card object-cover" />
            )}
            <div className="text-base font-semibold text-ink">{listing.title}</div>
            {listing.price && <div className="mt-1 text-sm font-semibold text-accent">{listing.price}</div>}
            {listing.description && (
              <p className="mt-2 whitespace-pre-line text-sm text-ink-soft">{listing.description}</p>
            )}
          </div>

          {canEmbed && (
            <div className="px-4 pb-4">
              {showSlowHint && !iframeLoaded && (
                <p className="mb-2 text-xs text-ink-soft">
                  O site do anúncio pode não abrir aqui dentro. Toque em &quot;Abrir em nova aba&quot;.
                </p>
              )}
              <div className="relative min-h-[70dvh] overflow-hidden rounded-card border border-border">
                {!iframeLoaded && (
                  <div className="absolute inset-0 animate-pulse bg-border/40" aria-hidden="true" />
                )}
                <iframe
                  src={url}
                  className="h-full w-full min-h-[70dvh]"
                  // No allow-same-origin: this frames an arbitrary third-party business site, not
                  // our own content — allow-scripts + allow-same-origin together would let a
                  // malicious page in the frame access its own origin as if unsandboxed, which is
                  // a known sandbox-escape combo. The page still renders/functions without it.
                  sandbox="allow-scripts allow-forms allow-popups"
                  referrerPolicy="no-referrer-when-downgrade"
                  loading="lazy"
                  onLoad={() => setIframeLoaded(true)}
                  title={listing.title}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
