"use client";

import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";

// Faithful port of apps/chat/src/components/ChatScreen.tsx's ListingCard/safeHttpUrl — kept as a
// standalone admin component (rather than a cross-app import) because apps/admin and apps/chat
// don't share a component package (packages/ui only holds design tokens, not React components).
// Any visual/markup change to ChatScreen.tsx's ListingCard must be mirrored here so this preview
// never drifts from what a real chat visitor actually sees.

function safeHttpUrl(u?: string | null): string | undefined {
  if (!u) return undefined;
  try {
    const parsed = new URL(u);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function formatPrice(listing: any): string | undefined {
  if (typeof listing.priceCents === "number") {
    return `R$ ${(listing.priceCents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}${
      listing.pricePeriod ? ` / ${listing.pricePeriod}` : ""
    }`;
  }
  if (listing.priceText) return listing.priceText;
  return undefined;
}

// Mirrors ChatScreen.tsx's ListingCard exactly (image box, title, price, line-clamped
// description, "Ver anúncio" pill) minus the live onOpen/onSelect taps — this is a static
// preview, not an actually-interactive chat card.
function PreviewCard({ listing }: { listing: any }) {
  const imageUrl = safeHttpUrl(listing.imageUrl ?? listing.images?.[0]);
  const [imageFailed, setImageFailed] = useState(false);
  const price = formatPrice(listing);
  const url = safeHttpUrl(listing.url ?? listing.sourceUrl);

  return (
    <div className="flex h-[23rem] w-56 shrink-0 flex-col overflow-hidden rounded-card border border-border bg-surface">
      <div className="flex flex-1 w-full flex-col overflow-hidden text-left">
        <div className="flex h-32 w-full shrink-0 items-center justify-center bg-border/40">
          {imageUrl && !imageFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={listing.title}
              className="h-32 w-full object-cover"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <span className="text-3xl" aria-hidden>
              🏠
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col p-3">
          <div className="line-clamp-2 text-sm font-semibold text-ink">{listing.title}</div>
          {price && <div className="mt-1 text-sm font-semibold text-accent">{price}</div>}
          {listing.description && <p className="mt-1 line-clamp-3 text-xs text-ink-soft">{listing.description}</p>}
        </div>
      </div>
      <div className="flex items-center gap-2 px-3 pb-3 pt-1">
        <span
          className={cn(
            "flex-1 rounded-full px-3 py-1.5 text-center text-xs font-medium",
            url ? "bg-accent text-white" : "invisible",
          )}
        >
          Ver anúncio
        </span>
      </div>
    </div>
  );
}

export function ListingPreview({
  listing,
  open,
  onOpenChange,
}: {
  listing: any | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-card bg-bg-2 p-4 shadow-xl outline-none">
          <Dialog.Close className="absolute right-3 top-3 rounded-lg p-1.5 text-ink-soft hover:bg-surface">
            <X className="h-5 w-5" />
            <span className="sr-only">Fechar</span>
          </Dialog.Close>
          <Dialog.Title className="mb-3 text-sm font-semibold text-ink">Como o cliente vê este anúncio</Dialog.Title>
          <Dialog.Description className="sr-only">
            Pré-visualização exata do cartão exibido no chat para este anúncio.
          </Dialog.Description>
          {listing && (
            <div className="flex justify-center py-2">
              <PreviewCard listing={listing} />
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
