"use client";

import { useEffect, useState } from "react";
import { getMe, updateBranding, updateWebsiteUrl } from "../../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";

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
    <div className="flex max-w-xl flex-col gap-6">
      <h1 className="font-serif text-2xl text-ink">Personalização</h1>

      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          <div>
            <Label>Cor da marca</Label>
            <div className="mt-1 flex items-center gap-3">
              <input type="color" value={brandColor} onChange={(e) => setBrandColor(e.target.value)} className="h-10 w-16 rounded-lg border border-border" />
              <span className="font-mono text-sm text-ink-soft">{brandColor}</span>
            </div>
          </div>
          <div>
            <Label>URL do logo</Label>
            <Input
              value={logoUrl}
              onChange={(e) => setLogoUrl(e.target.value)}
              placeholder="https://…"
              className="mt-1"
            />
          </div>
          <Button className="self-start" onClick={save}>
            {saved ? "Salvo!" : "Salvar"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Sincronizar site</CardTitle>
            <Badge variant="accent">Studio</Badge>
          </div>
          <CardDescription>
            No plano Studio, a Clara revisita o site do seu negócio toda semana e atualiza a base de conhecimento sozinha — você só precisa manter o site em dia.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!isStudio ? (
            <p className="rounded-lg border border-border bg-bg-2 px-4 py-3 text-sm text-ink-soft">
              Disponível no plano Studio.{" "}
              <a href="/billing" className="font-semibold text-accent">Ver planos</a>
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>URL do site</Label>
                <Input
                  value={websiteUrl}
                  onChange={(e) => setWebsiteUrl(e.target.value)}
                  placeholder="https://seusite.com.br"
                  type="url"
                />
              </div>
              <Button className="self-start" disabled={websiteUrl === websiteSavedUrl} onClick={saveWebsite}>
                {websiteSaved ? "Salvo!" : "Salvar"}
              </Button>
              {websiteSavedUrl && (
                <p className="text-xs text-ink-soft">
                  {websiteSyncedAt
                    ? `Última sincronização: ${new Date(websiteSyncedAt).toLocaleString("pt-BR")}`
                    : "Ainda não sincronizado — a primeira varredura roda na próxima segunda-feira."}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
