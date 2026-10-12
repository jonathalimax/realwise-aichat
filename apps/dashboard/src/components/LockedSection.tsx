import { ReactNode } from "react";
import Link from "next/link";
import { buttonVariants } from "./ui/button";
import { cn } from "../lib/utils";

export function LockedSection({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <div aria-hidden className="pointer-events-none select-none blur-sm opacity-50">
        {children}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-card bg-surface/60 p-4 text-center">
        <p className="font-serif text-sm text-ink">Disponível nos planos Profissional e Studio</p>
        <p className="max-w-xs text-xs text-ink-soft">Desbloqueie análises avançadas de tempo de resposta, qualidade de leads e imóveis/veículos mais procurados.</p>
        <Link href="/billing" className={cn(buttonVariants({ size: "sm" }), "mt-1")}>
          Ver planos
        </Link>
      </div>
    </div>
  );
}
