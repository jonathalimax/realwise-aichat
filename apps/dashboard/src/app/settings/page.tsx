"use client";

import { useEffect, useState } from "react";
import { getMe, updateBranding, updateWebsiteUrl } from "../../lib/api";

export default function SettingsPage() {
  const [brandColor, setBrandColor] = useState("#1F5F52");
  const [logoUrl, setLogoUrl] = useState("");
  const [saved, setSaved] = useState(false);

  const [websiteUrl, setWebsiteUrl] = useState("");
  const [websiteSavedUrl, setWebsiteSavedUrl] = useState("");
  const [websiteSyncedAt, setWebsiteSyncedAt] = useState<string | null>(null);
  const [planCode, setPlanCode] = useState<string | null>(null);
  const [websiteSaved, setWebsiteSaved] = useState(false);

  useEffect(() => {
    getMe().then((b) => {
      setBrandColor(b.brandColor ?? "#1F5F52");
      setLogoUrl(b.logoUrl ?? "");
      setWebsiteUrl(b.websiteUrl ?? "");
      setWebsiteSavedUrl(b.websiteUrl ?? "");
      setWebsiteSyncedAt(b.websiteSyncedAt ?? null);
      setPlanCode(b.subscription?.plan?.code ?? null);
    });
  }, []);

  async function save() {
    await updateBranding(logoUrl, brandColor);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function saveWebsite() {
    await updateWebsiteUrl(websiteUrl);
    setWebsiteSavedUrl(websiteUrl);
    setWebsiteSaved(true);
    setTimeout(() => setWebsiteSaved(false), 2000);
  }

  const isStudio = planCode === "studio";

  return (
    <div className="max-w-md">
      <h1 className="mb-5 font-serif text-2xl text-ink">Personalização</h1>
      <div className="flex flex-col gap-4">
        <div>
          <label className="text-xs text-ink-soft">Cor da marca</label>
          <div className="mt-1 flex items-center gap-3">
            <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-10 w-16 rounded-lg border border-border" />
            <span className="font-mono text-sm text-muted">{brandColor}</span>
          </div>
        </div>
        <div>
          <label className="text-xs text-ink-soft">URL do logo</label>
          <input
            value={logoUrl}
            onChange={(e) => setLogoUrl(e.target.value)}
            placeholder="https://…"
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
        </div>
        <button onClick={save} className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
          {saved ? "Salvo!" : "Salvar"}
        </button>
      </div>

      <div className="mt-10 border-t border-border pt-6">
        <div className="flex items-center gap-2">
          <h2 className="font-serif text-xl text-ink">Sincronizar site</h2>
          <span className="rounded-full bg-lime-soft px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide text-lime-ink">Studio</span>
        </div>
        <p className="mt-1 text-sm text-ink-soft">
          No plano Studio, a Clara revisita o site do seu negócio toda semana e atualiza a base de conhecimento sozinha — você só precisa manter o site em dia.
        </p>

        {!isStudio ? (
          <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-3 text-sm text-ink-soft">
            Disponível no plano Studio.{" "}
            <a href="/billing" className="font-semibold text-accent">Ver planos</a>
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-ink-soft">URL do site</span>
              <input
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://seusite.com.br"
                type="url"
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              />
            </label>
            <button
              onClick={saveWebsite}
              disabled={websiteUrl === websiteSavedUrl}
              className="self-start rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              {websiteSaved ? "Salvo!" : "Salvar"}
            </button>
            {websiteSavedUrl && (
              <p className="text-xs text-ink-soft">
                {websiteSyncedAt
                  ? `Última sincronização: ${new Date(websiteSyncedAt).toLocaleString("pt-BR")}`
                  : "Ainda não sincronizado — a primeira varredura roda na próxima segunda-feira."}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
