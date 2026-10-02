"use client";

import { useState } from "react";
import { Button } from "./ui/button";

export function ShareLink({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${process.env.NEXT_PUBLIC_CHAT_URL ?? "http://localhost:3005"}/${slug}`;

  async function copy() {
    await navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-2 rounded-card border border-border bg-bg-2 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-sm text-ink">Seu link de atendimento</div>
        <code className="block truncate text-xs text-ink-soft">{url}</code>
      </div>
      <Button variant="outline" size="sm" className="self-start sm:self-auto" onClick={copy}>
        {copied ? "Copiado!" : "Copiar link"}
      </Button>
    </div>
  );
}
