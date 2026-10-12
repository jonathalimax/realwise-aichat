"use client";

import { useState } from "react";
import { Button } from "./ui/button";

export function ShareLink({ slug, showInstructions }: { slug: string; showInstructions?: boolean }) {
  const [copied, setCopied] = useState(false);
  const url = `${process.env.NEXT_PUBLIC_CHAT_URL ?? "http://localhost:3005"}/${slug}`;

  async function copy() {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(url).catch(() => {});
    } else {
      // navigator.clipboard is unavailable outside secure contexts (e.g. http:// tailnet IPs)
      const textarea = document.createElement("textarea");
      textarea.value = url;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
      } catch {}
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-bg-2 p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm text-ink">Seu link de atendimento</div>
          <code className="block truncate text-xs text-ink-soft">{url}</code>
        </div>
        <Button variant="outline" size="sm" className="self-start sm:self-auto" onClick={copy}>
          {copied ? "Copiado!" : "Copiar link"}
        </Button>
      </div>
      {showInstructions && (
        <ul className="list-disc space-y-1 pl-4 text-xs text-ink-soft">
          <li>Coloca na bio do seu Instagram.</li>
          <li>Adiciona na descrição do seu perfil do WhatsApp Business.</li>
          <li>Inclui na sua ficha do Google Meu Negócio.</li>
          <li>Põe um botão no seu próprio site apontando para esse link.</li>
        </ul>
      )}
    </div>
  );
}
