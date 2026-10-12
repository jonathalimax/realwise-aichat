import { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "./ui/card";

export function InsightCard({
  icon,
  headline,
  description,
  ctaLabel,
  ctaHref,
}: {
  icon: ReactNode;
  headline: ReactNode;
  description: string;
  ctaLabel?: string;
  ctaHref?: string;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0 text-accent-ink">{icon}</div>
          <div className="flex flex-col gap-1">
            <p className="font-semibold text-ink">{headline}</p>
            <p className="text-sm text-ink-soft">{description}</p>
          </div>
        </div>
        {ctaLabel && ctaHref && (
          <Link
            href={ctaHref}
            className="inline-flex items-center gap-1 self-start text-sm font-semibold text-accent-ink hover:underline"
          >
            {ctaLabel}
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
