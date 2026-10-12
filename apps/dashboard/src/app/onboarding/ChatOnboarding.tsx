"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import {
  updateBusiness,
  checkSlugAvailable,
  setBusinessSlug,
  addWhatsappNumber,
  getWhatsappNumbers,
  publishBusiness,
  confirmLinkPlaced,
} from "../../lib/api";
import { InterviewChat } from "../../components/InterviewChat";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent } from "../../components/ui/card";
import { cn } from "../../lib/utils";
import { NICHES } from "./niches";

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

export function ChatOnboarding({
  business,
  refresh,
  onSwitchToWizard,
}: {
  business: any;
  refresh: () => Promise<void>;
  onSwitchToWizard: () => void;
}) {
  const hasRealSlug = !!business.slug && !business.slug.startsWith("pending-");
  const needsPreChat = !business.name || !hasRealSlug;

  const [phase, setPhase] = useState<"preChat" | "conversation">(needsPreChat ? "preChat" : "conversation");
  const [name, setName] = useState(business.name ?? "");
  const [niche, setNiche] = useState(business.niche ?? NICHES[0].value);
  const [submitting, setSubmitting] = useState(false);

  const [readyToPublish, setReadyToPublish] = useState(false);
  const [confidenceScore, setConfidenceScore] = useState<number | null>(null);
  const [whatsappNumbers, setWhatsappNumbers] = useState<any[]>([]);
  const [waLabel, setWaLabel] = useState("Principal");
  const [waPhone, setWaPhone] = useState("");

  async function handlePreChatSubmit() {
    if (!name.trim() || submitting) return;
    setSubmitting(true);
    try {
      await updateBusiness({ name: name.trim(), niche });

      let candidate = slugify(name.trim());
      if (candidate) {
        const available = await checkSlugAvailable(candidate);
        if (!available) candidate = `${candidate}-${randomSuffix()}`;
        try {
          await setBusinessSlug(candidate);
        } catch {
          // Slug race or validation error on the backend — proceed anyway, fixable later in settings.
        }
      }

      await refresh();
      setPhase("conversation");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddWhatsapp() {
    if (!waPhone) return;
    await addWhatsappNumber(waLabel, waPhone);
    setWhatsappNumbers(await getWhatsappNumbers());
    setWaPhone("");
  }

  async function handlePublish() {
    await publishBusiness();
    await refresh();
  }

  async function loadWhatsappNumbers() {
    setWhatsappNumbers(await getWhatsappNumbers());
  }

  const score = confidenceScore ?? business.confidenceScore ?? 0;
  const publicUrl = `${process.env.NEXT_PUBLIC_CHAT_URL ?? "http://localhost:3005"}/${business.slug}`;

  if (phase === "preChat") {
    return (
      <div className="flex flex-col gap-6">
        <div className="mb-2 text-center">
          <h1 className="font-serif text-2xl text-ink">Antes de começar, como se chama seu negócio? 👋</h1>
          <p className="mt-2 text-sm text-ink-soft">A Clara vai usar isso para conversar com você.</p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label>Nome do negócio</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Imóveis Vale Real" />
        </div>

        <div className="flex flex-col gap-3">
          <Label>Qual é o seu segmento?</Label>
          <div className="grid gap-3 sm:grid-cols-2">
            {NICHES.map(({ value, label, description, icon: Icon }) => {
              const selected = niche === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setNiche(value)}
                  className={cn(
                    "flex flex-col items-center gap-3 rounded-cardLarge border p-5 text-center transition-colors",
                    selected ? "border-accent bg-accent/5" : "border-border hover:bg-bg-2",
                  )}
                >
                  <div className="flex h-16 w-16 items-center justify-center rounded-cardLarge bg-lime-soft">
                    <Icon className="h-8 w-8 text-lime-ink" />
                  </div>
                  <div className="font-serif text-base text-ink">{label}</div>
                  <p className="text-xs leading-relaxed text-ink-soft">{description}</p>
                </button>
              );
            })}
          </div>
        </div>

        <Button size="pill" className="mx-auto" disabled={!name.trim() || submitting} onClick={handlePreChatSubmit}>
          Continuar
        </Button>

        <button type="button" onClick={onSwitchToWizard} className="mx-auto text-xs text-ink-soft underline">
          Prefiro preencher manualmente
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="mb-2 text-center">
        <h1 className="font-serif text-2xl text-ink">Hora de conversar com a Clara 💬</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Manda documentos, responde as perguntas — a Clara monta o perfil do seu negócio com você.
        </p>
      </div>

      <InterviewChat
        onFieldFilled={refresh}
        onStateChange={(s) => {
          setReadyToPublish(s.readyToPublish);
          setConfidenceScore(s.confidenceScore);
          if (s.readyToPublish) loadWhatsappNumbers();
        }}
      />

      {readyToPublish && (
        <div className="flex flex-col gap-4">
          {whatsappNumbers.length === 0 && (
            <Card>
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-lime-soft">
                    <MessageCircle className="h-5 w-5 text-lime-ink" />
                  </div>
                  <span className="text-sm font-semibold text-ink">Número de escalonamento</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Input value={waLabel} onChange={(e) => setWaLabel(e.target.value)} placeholder="Label" className="w-full sm:w-32" />
                  <Input value={waPhone} onChange={(e) => setWaPhone(e.target.value)} placeholder="(11) 99999-9999" className="flex-1" />
                  <Button variant="outline" size="sm" onClick={handleAddWhatsapp}>Adicionar</Button>
                </div>
              </CardContent>
            </Card>
          )}
          {whatsappNumbers.length > 0 && (
            <div className="flex flex-col gap-2">
              {whatsappNumbers.map((n) => (
                <div key={n.id} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink">{n.label}: {n.phone}</div>
              ))}
            </div>
          )}

          <Card>
            <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
              <Badge variant={score >= 70 ? "positive" : "warning"}>
                {score >= 70 ? "Pronto para publicar" : "Preencha os campos obrigatórios para chegar a 70%"}
              </Badge>
              {business.status !== "live" ? (
                <Button size="pill" disabled={score < 70} onClick={handlePublish}>Publicar</Button>
              ) : (
                <>
                  <div className="text-sm font-semibold text-ink">Seu link está pronto:</div>
                  <code className="rounded bg-bg-2 px-2 py-1 text-xs">{publicUrl}</code>
                  <Button size="pill" onClick={() => confirmLinkPlaced().then(refresh)}>Já coloquei o link na bio</Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <button type="button" onClick={onSwitchToWizard} className="mx-auto text-xs text-ink-soft underline">
        Prefiro preencher manualmente
      </button>
    </div>
  );
}
