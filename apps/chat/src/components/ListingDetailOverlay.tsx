"use client";

import { useEffect, useRef, useState } from "react";

export interface Listing {
  id?: string;
  title: string;
  price?: string;
  description?: string;
  url?: string;
  imageUrl?: string;
  images?: string[];
}

// listing.url/imageUrl/images come from LLM-parsed JSON, not from code we control — only ever
// render them if they're a genuine http(s) URL, since a malformed/adversarial model response could
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

// Same step/gap math as ChatScreen.tsx's ListingCards gallery strip, sized for this overlay's
// full-width slides instead of the w-56 card.
const MAX_VISIBLE_DOTS = 8;

// Swipeable horizontal photo gallery, following the exact pattern used by ChatScreen.tsx's
// ListingCards: a snap-x strip with onScroll-computed active index and a capped dot indicator.
// Renders nothing when there are no real photos — no empty bordered box.
function Gallery({ title, photos }: { title: string; photos: string[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [failed, setFailed] = useState<Record<number, boolean>>({});
  const containerRef = useRef<HTMLDivElement>(null);

  const visiblePhotos = photos.filter((_, i) => !failed[i]);
  if (visiblePhotos.length === 0) return null;

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    const step = el.clientWidth;
    if (step <= 0) return;
    const index = Math.round(el.scrollLeft / step);
    setActiveIndex(Math.max(0, Math.min(index, visiblePhotos.length - 1)));
  }

  return (
    <div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex w-full scroll-smooth snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
      >
        {photos.map((photo, i) =>
          failed[i] ? null : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${photo}-${i}`}
              src={photo}
              alt={title}
              className="h-56 w-full flex-none snap-start object-cover"
              onError={() => setFailed((prev) => ({ ...prev, [i]: true }))}
            />
          ),
        )}
      </div>
      {visiblePhotos.length > 1 && (
        <div className="mt-1 flex items-center justify-center gap-1">
          {visiblePhotos.length <= MAX_VISIBLE_DOTS ? (
            visiblePhotos.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full ${i === activeIndex ? "bg-accent" : "bg-border"}`}
              />
            ))
          ) : (
            <span className="text-xs text-ink-soft">
              {activeIndex + 1}/{visiblePhotos.length}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// In-app bottom sheet for a listing's full detail — a photo gallery plus a CTA linking out to the
// real listing page. There is no reliable embedded view: many business sites (confirmed live for
// Allure) block framing via CSP/X-Frame-Options, so this never attempts an iframe — the gallery +
// "Ver no site" CTA is the whole experience.
export function ListingDetailOverlay({ listing, onClose }: { listing: Listing; onClose: () => void }) {
  const [mounted, setMounted] = useState(false);
  const touchStartYRef = useRef<number | null>(null);

  const url = safeHttpUrl(listing.url);
  const gallery = (listing.images?.length ? listing.images : [listing.imageUrl])
    .map((u) => safeHttpUrl(u))
    .filter((u): u is string => Boolean(u));

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
              <div className="break-words text-sm font-semibold text-ink">{listing.title}</div>
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
          {gallery.length > 0 && (
            <div className="mb-3">
              <Gallery title={listing.title} photos={gallery} />
            </div>
          )}
          <div className="p-4 pt-0">
            <div className="break-words text-base font-semibold text-ink">{listing.title}</div>
            {listing.price && <div className="mt-1 text-sm font-semibold text-accent">{listing.price}</div>}
            {listing.description && (
              <p className="mt-2 whitespace-pre-line break-words text-sm text-ink-soft">{listing.description}</p>
            )}
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 block rounded-full bg-accent px-4 py-3 text-center text-sm font-medium text-white"
              >
                Ver no site da Allure
              </a>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
