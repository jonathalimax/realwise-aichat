"use client";

import { useEffect, useState } from "react";
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
import { Textarea } from "../../components/ui/textarea";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";

const STEPS = ["Negócio", "Documentos", "Entrevista", "Revisão", "WhatsApp", "Publicar"];

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

  return (
    <div className="mx-auto max-w-2xl">
      {business.trialEndsAt && (
        <div className="mb-4 rounded-lg bg-lime-soft px-3 py-2 text-xs font-semibold text-lime-ink">
          Você tem 7 dias grátis — seu teste termina em {new Date(business.trialEndsAt).toLocaleDateString("pt-BR")}.
        </div>
      )}
      <div className="mb-6 flex gap-2">
        {STEPS.map((label, i) => (
          <button
            key={label}
            onClick={() => setStep(i)}
            className={`flex-1 border-t-2 pt-2 text-left text-xs transition-colors hover:text-ink ${i === step ? "border-accent text-accent-ink font-semibold" : "border-border text-ink-soft"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {step === 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-serif text-xl">Sobre o seu negócio</h2>
          <Input
            value={business.name}
            onChange={(e) => setBusiness({ ...business, name: e.target.value })}
            placeholder="Nome do negócio"
          />
          <Input
            value={business.ownerName}
            onChange={(e) => setBusiness({ ...business, ownerName: e.target.value })}
            placeholder="Seu nome"
          />
          <Input
            value={business.email ?? ""}
            onChange={(e) => setBusiness({ ...business, email: e.target.value })}
            placeholder="Seu e-mail (avisos sobre o período de teste)"
            type="email"
          />
          <select
            value={business.niche}
            onChange={(e) => setBusiness({ ...business, niche: e.target.value })}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-ink"
          >
            <option value="imobiliaria">Imobiliária</option>
            <option value="concessionaria">Concessionária</option>
          </select>
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
          <Button onClick={saveBusinessInfo}>Continuar</Button>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <h2 className="font-serif text-xl">Manda o que você já tem</h2>
          <input type="file" onChange={handleFileUpload} className="text-sm" />
          <Textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder="Ou cole aqui um texto (tabela de preços, horários, políticas…)"
            rows={5}
          />
          <Button variant="outline" size="sm" className="self-start" onClick={handlePasteText}>Adicionar texto</Button>
          <div className="flex flex-col gap-1">
            {documents.map((d) => (
              <div key={d.id} className="flex justify-between rounded-lg border border-border bg-surface px-3 py-2 text-xs">
                <span>{d.filename}</span>
                <span className="text-ink-soft">{d.status}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(0)}>Voltar</Button>
            <Button onClick={() => setStep(2)}>Continuar</Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-serif text-xl">Entrevista com a Clara</h2>
          <p className="text-xs text-ink-soft">
            A Clara já leu os documentos que você mandou. Agora ela só vai perguntar o que ainda falta.
          </p>
          <InterviewChat onFieldFilled={refresh} />
          <div className="mt-2 flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)}>Voltar</Button>
            <Button onClick={() => setStep(3)}>Continuar</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-serif text-xl">Revisão</h2>
          {pendingFieldsCount > 0 ? (
            <p className="text-sm text-ink-soft">
              Seu perfil ainda precisa de{" "}
              <span className="font-semibold text-ink">{pendingFieldsCount} {pendingFieldsCount === 1 ? "campo" : "campos"}</span>{" "}
              aprovado{pendingFieldsCount === 1 ? "" : "s"}. Revise e aprove tudo na{" "}
              <a href="/knowledge" className="text-accent-ink underline">Base de conhecimento</a>.
            </p>
          ) : (
            <p className="text-sm text-positive">Tudo revisado e aprovado 🎉</p>
          )}
          <div className="mt-2 flex gap-2">
            <Button variant="outline" onClick={() => setStep(2)}>Voltar</Button>
            <Button onClick={() => { handleRecompute(); setStep(4); }}>Continuar</Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-serif text-xl">Número de WhatsApp para escalonamento</h2>
          <p className="text-xs text-ink-soft">Necessário para o chat conseguir passar um cliente para um atendente humano.</p>
          <div className="flex gap-2">
            <Input value={waLabel} onChange={(e) => setWaLabel(e.target.value)} placeholder="Label" className="w-32" />
            <Input value={waPhone} onChange={(e) => setWaPhone(e.target.value)} placeholder="(11) 99999-9999" className="flex-1" />
            <Button variant="outline" size="sm" onClick={handleAddWhatsapp}>Adicionar</Button>
          </div>
          {whatsappNumbers.map((n) => (
            <div key={n.id} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">{n.label}: {n.phone}</div>
          ))}
          <div className="mt-2 flex gap-2">
            <Button variant="outline" onClick={() => setStep(3)}>Voltar</Button>
            <Button onClick={() => setStep(5)}>Continuar</Button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-serif text-xl">Medidor de prontidão</h2>
          <div className="rounded-card border border-border bg-surface p-5 text-center">
            <div className="font-mono text-3xl text-ink">{business.confidenceScore}%</div>
            <Badge variant={business.confidenceScore >= 70 ? "positive" : "warning"} className="mt-2">
              {business.confidenceScore >= 70 ? "Pronto para publicar" : "Preencha os campos obrigatórios para chegar a 70%"}
            </Badge>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(4)}>Voltar</Button>
            <Button variant="outline" size="sm" onClick={handleRecompute}>Recalcular</Button>
          </div>

          {business.status !== "live" ? (
            <Button className="mt-2" disabled={business.confidenceScore < 70} onClick={handlePublish}>
              Publicar
            </Button>
          ) : (
            <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
              <div className="text-sm text-ink">Seu link está pronto:</div>
              <code className="rounded bg-bg-2 px-2 py-1 text-xs">{publicUrl}</code>
              <Button onClick={() => confirmLinkPlaced().then(refresh)}>Já coloquei o link na bio</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
