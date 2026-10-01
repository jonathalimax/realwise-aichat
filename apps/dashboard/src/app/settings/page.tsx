"use client";

import { useEffect, useState } from "react";
import { getMe, updateBranding } from "../../lib/api";

export default function SettingsPage() {
  const [brandColor, setBrandColor] = useState("#1F5F52");
  const [logoUrl, setLogoUrl] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getMe().then((b) => {
      setBrandColor(b.brandColor ?? "#1F5F52");
      setLogoUrl(b.logoUrl ?? "");
    });
  }, []);

  async function save() {
    await updateBranding(logoUrl, brandColor);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

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
    </div>
  );
}
