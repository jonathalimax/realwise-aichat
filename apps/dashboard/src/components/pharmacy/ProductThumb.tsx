"use client";

import { Package, Pill, FlaskConical } from "lucide-react";
import { API_BASE_URL } from "../../lib/api";
import { assetUrl } from "../../lib/format";
import type { Product } from "../../lib/pharmacy-api";
import { cn } from "../../lib/utils";

// placeholder tint by sale class (prototype palette)
const TINT: Record<Product["saleClass"], string> = {
  otc: "bg-green-100 text-green-800",
  prescription: "bg-amber-100 text-amber-800",
  controlled: "bg-zinc-200 text-zinc-700",
  unclassified: "bg-red-100 text-red-800",
};

/** Product image when `imageUrl` exists, else a tinted placeholder icon chosen by product type (pill / bottle / box). */
export function ProductThumb({ product, size = "md", className }: { product: Pick<Product, "imageUrl" | "placeholderIcon" | "saleClass" | "name">; size?: "md" | "lg"; className?: string }) {
  const box = size === "lg" ? "h-24 w-24 rounded-2xl" : "h-11 w-11 rounded-[10px]";
  const icon = size === "lg" ? "h-11 w-11" : "h-6 w-6";
  const src = assetUrl(product.imageUrl, API_BASE_URL);
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={product.name} className={cn(box, "flex-none bg-bg-2 object-cover", className)} loading="lazy" />;
  }
  const Icon = product.placeholderIcon === "bottle" ? FlaskConical : product.placeholderIcon === "box" ? Package : Pill;
  return (
    <span aria-hidden className={cn(box, "inline-flex flex-none items-center justify-center", TINT[product.saleClass], className)}>
      <Icon className={icon} strokeWidth={1.6} />
    </span>
  );
}
