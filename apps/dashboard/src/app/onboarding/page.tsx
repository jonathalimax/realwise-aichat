"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, Car, Upload, MessageCircle } from "lucide-react";
import {
  getMe,
  updateBusiness,
  checkSlugAvailable,
  setBusinessSlug,
  getOnboardingProfile,
  recomputeConfidence,
  uploadDocumentFile,
  uploadDocumentText,
  getDocuments,
  addWhatsappNumber,
  getWhatsappNumbers,
  publishBusiness,
  confirmLinkPlaced,
} from "../../lib/api";
import { InterviewChat } from "../../components/InterviewChat";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent } from "../../components/ui/card";
import { cn } from "../../lib/utils";

const STEPS = ["Negócio", "Documentos", "Entrevista", "Revisão", "WhatsApp", "Publicar"];

const NICHES = [
  {
    value: "imobiliaria",
    label: "Imobiliária",
    description: "Locação e venda de imóveis — a Clara ajuda seus clientes a encontrar o imóvel certo.",
    icon: Building2,
  },
  {
    value: "concessionaria",
    label: "Concessionária",
    description: "Venda de veículos — a Clara ajuda seus clientes a encontrar o carro ideal e agendar test-drives.",
    icon: Car,
  },
] as const;

function StepIndicator({ step }: { step: number }) {
  return (
    <div className="mb-10 flex flex-col items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
        Passo {step + 1} de {STEPS.length} · {STEPS[step]}
      </span>
      <div className="flex gap-1.5">
        {STEPS.map((label, i) => (
          <span
            key={label}
            className={cn(
              "h-1.5 w-8 rounded-full transition-colors",
              i === step ? "bg-accent" : i < step ? "bg-accent/40" : "bg-border",
            )}
          />
        ))}
      </div>
    </div>
  );
}

function StepHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-8 text-center">
      <h1 className="font-serif text-2xl text-ink">{title}</h1>
      <p className="mt-2 text-sm text-ink-soft">{subtitle}</p>
    </div>
  );
}

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [business, setBusiness] = useState<any>(null);
  const [slug, setSlug] = useState("");
  const [slugStatus, setSlugStatus] = useState<"idle" | "available" | "taken">("idle");
  const [profile, setProfile] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [whatsappNumbers, setWhatsappNumbers] = useState<any[]>([]);
  const [waLabel, setWaLabel] = useState("Principal");
  const [waPhone, setWaPhone] = useState("");

  async function refresh() {
    const b = await getMe();
    setBusiness(b);
    setSlug(b.slug?.startsWith("pending-") ? "" : b.slug);
    const p = await getOnboardingProfile();
    setProfile(p);
    setDocuments(await getDocuments());
    setWhatsappNumbers(await getWhatsappNumbers());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCheckSlug() {
    const available = await checkSlugAvailable(slug);
    setSlugStatus(available ? "available" : "taken");
  }

  async function saveBusinessInfo() {
    await updateBusiness({ name: business.name, ownerName: business.ownerName, email: business.email, niche: business.niche });
    if (slug && slugStatus === "available") await setBusinessSlug(slug);
    setStep(1);
    refresh();
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadDocumentFile(file);
    setDocuments(await getDocuments());
  }

  async function handlePasteText() {
    if (!pastedText.trim()) return;
    await uploadDocumentText(`texto-${Date.now()}`, pastedText);
    setPastedText("");
    setDocuments(await getDocuments());
  }

  async function handleRecompute() {
    await recomputeConfidence();
    setBusiness(await getMe());
  }

  async function handleAddWhatsapp() {
    if (!waPhone) return;
    await addWhatsappNumber(waLabel, waPhone);
    setWhatsappNumbers(await getWhatsappNumbers());
    setWaPhone("");
  }

  async function handlePublish() {
    await publishBusiness();
    setStep(5);
    refresh();
  }

  if (!business || !profile) return <p className="text-ink-soft">Carregando…</p>;

  const fieldStatus = profile.profile?.fieldStatus ?? {};
  const pendingFieldsCount = (profile.template?.fields ?? []).filter(
    (f: any) => !fieldStatus[f.key]?.approvedByOwner,
  ).length;
  const publicUrl = `${process.env.NEXT_PUBLIC_CHAT_URL ?? "http://localhost:3005"}/${business.slug}`;
  const score = business.confidenceScore ?? 0;

  return (
    <div className="mx-auto max-w-2xl py-6">
      {business.trialEndsAt && (
        <Card className="mb-6">
          <CardContent className="p-3 text-center text-xs font-semibold text-accent-ink">
            Você tem 7 dias grátis — seu teste termina em {new Date(business.trialEndsAt).toLocaleDateString("pt-BR")}.
          </CardContent>
        </Card>
      )}

      <StepIndicator step={step} />

      {step === 0 && (
        <div className="flex flex-col gap-6">
          <StepHeader title="Vamos configurar seu negócio! 👋" subtitle="Só precisamos de algumas informações para começar." />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Nome do negócio</Label>
              <Input
                value={business.name}
                onChange={(e) => setBusiness({ ...business, name: e.target.value })}
                placeholder="Ex: Imóveis Vale Real"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Seu nome</Label>
              <Input
                value={business.ownerName}
                onChange={(e) => setBusiness({ ...business, ownerName: e.target.value })}
                placeholder="Seu nome"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>E-mail</Label>
            <Input
              value={business.email ?? ""}
              onChange={(e) => setBusiness({ ...business, email: e.target.value })}
              placeholder="Seu e-mail (avisos sobre o período de teste)"
              type="email"
            />
          </div>

          <div className="flex flex-col gap-3">
            <Label>Qual é o seu segmento?</Label>
            <div className="grid gap-3 sm:grid-cols-2">
              {NICHES.map(({ value, label, description, icon: Icon }) => {
                const selected = business.niche === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setBusiness({ ...business, niche: value })}
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

          <div className="flex flex-col gap-1.5">
            <Label>Seu link</Label>
            <div className="flex gap-2">
              <Input
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                  setSlugStatus("idle");
                }}
                placeholder="seu-link (ex: imoveis-vale-real)"
                className="flex-1"
              />
              <Button variant="outline" size="sm" onClick={handleCheckSlug}>Verificar</Button>
            </div>
            {slugStatus === "available" && <p className="text-xs text-positive">Disponível!</p>}
            {slugStatus === "taken" && <p className="text-xs text-negative">Já em uso.</p>}
          </div>

          <Button size="pill" className="mx-auto" onClick={saveBusinessInfo}>Continuar</Button>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-6">
          <StepHeader title="Manda o que você já tem 📄" subtitle="PDF, Word, fotos ou só cola um texto — a Clara aprende com o que você mandar." />

          <label className="flex cursor-pointer flex-col items-center gap-3 rounded-cardLarge border-2 border-dashed border-border p-8 text-center transition-colors hover:border-accent hover:bg-accent/5">
            <div className="flex h-14 w-14 items-center justify-center rounded-cardLarge bg-accent-soft">
              <Upload className="h-7 w-7 text-accent-ink" />
            </div>
            <span className="text-sm font-semibold text-ink">Clique para enviar um arquivo</span>
            <span className="text-xs text-ink-soft">PDF, Word ou imagens</span>
            <input type="file" onChange={handleFileUpload} className="hidden" />
          </label>

          <Card>
            <CardContent className="flex flex-col gap-3 p-5">
              <p className="text-sm font-semibold text-ink">Ou cole um texto</p>
              <Textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Tabela de preços, horários, políticas…"
                rows={5}
              />
              <Button variant="outline" size="sm" className="self-start" onClick={handlePasteText}>Adicionar texto</Button>
            </CardContent>
          </Card>

          {documents.length > 0 && (
            <div className="flex flex-col gap-2">
              {documents.map((d) => (
                <div key={d.id} className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-sm">
                  <span className="text-ink">{d.filename}</span>
                  <Badge variant={d.status === "processed" ? "positive" : "neutral"}>{d.status}</Badge>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => setStep(0)}>Voltar</Button>
            <Button size="pill" onClick={() => setStep(2)}>Continuar</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <StepHeader
            title="Hora de conversar com a Clara 💬"
            subtitle="A Clara já leu os documentos que você mandou. Agora ela só vai perguntar o que ainda falta."
          />
          <InterviewChat onFieldFilled={refresh} />
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => setStep(1)}>Voltar</Button>
            <Button size="pill" onClick={() => setStep(3)}>Continuar</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-6">
          <StepHeader title="Vamos revisar? ✅" subtitle="Confira se está tudo certo antes de seguir." />
          <Card>
            <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
              {pendingFieldsCount > 0 ? (
                <p className="text-sm text-ink-soft">
                  Seu perfil ainda precisa de{" "}
                  <span className="font-semibold text-ink">{pendingFieldsCount} {pendingFieldsCount === 1 ? "campo" : "campos"}</span>{" "}
                  aprovado{pendingFieldsCount === 1 ? "" : "s"}. Revise e aprove tudo na{" "}
                  <Link href="/knowledge" className="text-accent-ink underline">Base de conhecimento</Link>.
                </p>
              ) : (
                <p className="text-sm font-semibold text-positive">Tudo revisado e aprovado 🎉</p>
              )}
            </CardContent>
          </Card>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => setStep(2)}>Voltar</Button>
            <Button size="pill" onClick={() => { handleRecompute(); setStep(4); }}>Continuar</Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-6">
          <StepHeader
            title="Para onde mandamos os clientes quentes? 📱"
            subtitle="Necessário para o chat conseguir passar um cliente para um atendente humano."
          />
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
          {whatsappNumbers.length > 0 && (
            <div className="flex flex-col gap-2">
              {whatsappNumbers.map((n) => (
                <div key={n.id} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink">{n.label}: {n.phone}</div>
              ))}
            </div>
          )}
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => setStep(3)}>Voltar</Button>
            <Button size="pill" onClick={() => setStep(5)}>Continuar</Button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="flex flex-col gap-6">
          <StepHeader title="Quase lá! 🎉" subtitle="Veja o quão pronto seu perfil está para receber clientes." />

          <Card>
            <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
              <div className="font-mono text-5xl font-bold text-ink">{score}%</div>
              <div className="h-2 w-full max-w-xs overflow-hidden rounded-full bg-bg-2">
                <div
                  className={cn("h-full rounded-full transition-all", score >= 70 ? "bg-positive" : "bg-warning")}
                  style={{ width: `${Math.min(score, 100)}%` }}
                />
              </div>
              <Badge variant={score >= 70 ? "positive" : "warning"}>
                {score >= 70 ? "Pronto para publicar" : "Preencha os campos obrigatórios para chegar a 70%"}
              </Badge>
            </CardContent>
          </Card>

          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => setStep(4)}>Voltar</Button>
            <Button variant="outline" size="sm" onClick={handleRecompute}>Recalcular</Button>
          </div>

          {business.status !== "live" ? (
            <Button size="pill" className="mx-auto" disabled={score < 70} onClick={handlePublish}>
              Publicar
            </Button>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
                <div className="text-sm font-semibold text-ink">Seu link está pronto:</div>
                <code className="rounded bg-bg-2 px-2 py-1 text-xs">{publicUrl}</code>
                <p className="text-xs text-ink-soft">
                  Coloca na bio do Instagram, na descrição do perfil do WhatsApp Business, na sua ficha do Google Meu Negócio, ou adiciona um botão no seu próprio site.
                </p>
                <Button size="pill" onClick={() => confirmLinkPlaced().then(refresh)}>Já coloquei o link na bio</Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
