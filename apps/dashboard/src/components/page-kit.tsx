"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Skeleton } from "./ui/skeleton";
import { NoAccess } from "./shell/NoAccess";
import { Label } from "./ui/label";
import { cn } from "../lib/utils";
import { isMissingRoute } from "../lib/use-load";
import type { PermissionSection } from "@realwise/shared";

/** Page title row: h1 + subtitle on the left, actions on the right (prototype `.h1` / muted paragraph). */
export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="flex flex-col gap-1">
      {back && (
        <Link href={back.href} className="w-fit text-[13px] text-muted hover:text-ink">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function PageStack({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cn("mx-auto flex w-full flex-col gap-5", wide ? "max-w-[1280px]" : "max-w-[1280px]", className)}>{children}</div>;
}

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-bg-2 text-muted">{icon ?? <Inbox className="h-5 w-5" aria-hidden />}</span>
      <p className="font-semibold text-ink">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry, what = "estes dados" }: { error: Error; onRetry?: () => void; what?: string }) {
  const missing = isMissingRoute(error);
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-amber-800">
        <AlertTriangle className="h-5 w-5" aria-hidden />
      </span>
      <p className="font-semibold text-ink">{missing ? "Esta área ainda não está disponível" : `Não consegui carregar ${what}`}</p>
      <p className="max-w-sm text-sm text-muted">
        {missing ? "O servidor ainda não tem esta função. Ela aparece aqui assim que for ativada." : error.message}
      </p>
      {onRetry && !missing && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-3.5 w-3.5" /> Tentar de novo
        </Button>
      )}
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-3 p-5" aria-busy="true" aria-label="Carregando">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

/**
 * Standard body of a data card/page: 403 -> "Sem acesso", error -> retry, loading -> skeleton, else children.
 * `bare` renders the states without a card (when the page itself already is one).
 */
export function LoadState({
  state,
  section,
  what,
  skeleton,
  children,
}: {
  state: { loading: boolean; error: Error | null; forbidden: boolean; reload: () => Promise<void>; data: unknown };
  section?: PermissionSection;
  what?: string;
  skeleton?: ReactNode;
  children: ReactNode;
}) {
  if (state.forbidden) return <NoAccess section={section} />;
  if (state.error && !state.data) return <ErrorState error={state.error} onRetry={() => void state.reload()} what={what} />;
  if (state.loading && !state.data) return <>{skeleton ?? <TableSkeleton />}</>;
  return <>{children}</>;
}

export function Field({ label, htmlFor, hint, children, className, badge }: { label: ReactNode; htmlFor?: string; hint?: ReactNode; children: ReactNode; className?: string; badge?: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="flex items-center gap-2">
        {label}
        {badge}
      </Label>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </div>
  );
}

export function SearchBox({ value, onChange, placeholder, label, className }: { value: string; onChange: (v: string) => void; placeholder: string; label: string; className?: string }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
      className={cn(
        "h-9 w-full rounded-lg border border-border bg-surface px-3 text-base text-ink outline-none placeholder:text-muted/70 focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/25 md:text-sm",
        className,
      )}
    />
  );
}

/** Link styled as a button (next/link keeps client navigation). */
export function LinkButton({ href, children, variant = "default", size = "default", className }: { href: string; children: ReactNode; variant?: "default" | "outline" | "ghost"; size?: "default" | "sm" | "lg"; className?: string }) {
  return (
    <Link href={href} className={cn(buttonVariants({ variant, size }), className)}>
      {children}
    </Link>
  );
}

/** Card with the standard 20px gutter. `flush` removes the body padding (tables/lists that bleed to the card edges and pad their own first/last cell). */
export function SectionCard({ title, description, action, children, className, flush, bodyClassName }: { title?: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; flush?: boolean; bodyClassName?: string }) {
  return (
    <Card className={className}>
      {title && (
        <div data-slot="card-header" className="flex items-start justify-between gap-3 p-5 pb-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
          </div>
          {action && <div className="flex flex-none items-center gap-2">{action}</div>}
        </div>
      )}
      <CardContent className={cn(flush ? "p-0 pb-1" : title ? "p-5 pt-1" : "p-5", bodyClassName)}>{children}</CardContent>
    </Card>
  );
}
