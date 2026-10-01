"use client";

import { useEffect, useState } from "react";
import {
  getMe,
  updateBusiness,
  checkSlugAvailable,
  setBusinessSlug,
  getOnboardingProfile,
  patchProfileField,
  approveProfileField,
  recomputeConfidence,
  uploadDocumentFile,
  uploadDocumentText,
  getDocuments,
  addWhatsappNumber,
  getWhatsappNumbers,
  publishBusiness,
  confirmLinkPlaced,
} from "../../lib/api";

const STEPS = ["Negócio", "Documentos", "Entrevista", "Revisão", "WhatsApp", "Publicar"];

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [business, setBusiness] = useState<any>(null);
  const [slug, setSlug] = useState("");
  const [slugStatus, setSlugStatus] = useState<"idle" | "available" | "taken">("idle");
  const [profile, setProfile] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [confidence, setConfidence] = useState<any>(null);
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
    await updateBusiness({ name: business.name, ownerName: business.ownerName, niche: business.niche });
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

  async function handleFieldChange(fieldKey: string, value: string) {
    await patchProfileField(fieldKey, value, "interview");
    setProfile(await getOnboardingProfile());
  }

  async function handleApprove(fieldKey: string) {
    await approveProfileField(fieldKey);
    setProfile(await getOnboardingProfile());
  }

  async function handleRecompute() {
    setConfidence(await recomputeConfidence());
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

  if (!business || !profile) return <p className="text-muted">Carregando…</p>;

  const data = profile.profile?.data ?? {};
  const fieldStatus = profile.profile?.fieldStatus ?? {};
  const publicUrl = `${process.env.NEXT_PUBLIC_CHAT_URL ?? "http://localhost:3000"}/${business.slug}`;

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-6 flex gap-2">
        {STEPS.map((label, i) => (
          <div key={label} className={`flex-1 border-t-2 pt-2 text-xs ${i === step ? "border-accent text-accent-ink font-semibold" : "border-border text-muted"}`}>
            {label}
          </div>
        ))}
      </div>

      {step === 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-serif text-xl">Sobre o seu negócio</h2>
          <input
            value={business.name}
            onChange={(e) => setBusiness({ ...business, name: e.target.value })}
            placeholder="Nome do negócio"
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
          <input
            value={business.ownerName}
            onChange={(e) => setBusiness({ ...business, ownerName: e.target.value })}
            placeholder="Seu nome"
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
          <select
            value={business.niche}
            onChange={(e) => setBusiness({ ...business, niche: e.target.value })}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          >
            <option value="imobiliaria">Imobiliária</option>
            <option value="concessionaria">Concessionária</option>
          </select>
          <div className="flex gap-2">
            <input
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugStatus("idle");
              }}
              placeholder="seu-link (ex: imoveis-vale-real)"
              className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            />
            <button onClick={handleCheckSlug} className="rounded-lg border border-border px-3 py-2 text-xs">
              Verificar
            </button>
          </div>
          {slugStatus === "available" && <p className="text-xs text-positive">Disponível!</p>}
          {slugStatus === "taken" && <p className="text-xs text-negative">Já em uso.</p>}
          <button onClick={saveBusinessInfo} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
            Continuar
          </button>
        </div>
      )}

      {step === 1 && (
        <div className="flex flex-col gap-4">
          <h2 className="font-serif text-xl">Manda o que você já tem</h2>
          <input type="file" onChange={handleFileUpload} className="text-sm" />
          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder="Ou cole aqui um texto (tabela de preços, horários, políticas…)"
            rows={5}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
          <button onClick={handlePasteText} className="self-start rounded-lg border border-border px-3 py-2 text-xs">
            Adicionar texto
          </button>
          <div className="flex flex-col gap-1">
            {documents.map((d) => (
              <div key={d.id} className="flex justify-between rounded-lg border border-border bg-surface px-3 py-2 text-xs">
                <span>{d.filename}</span>
                <span className="text-muted">{d.status}</span>
              </div>
            ))}
          </div>
          <button onClick={() => setStep(2)} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
            Continuar
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-serif text-xl">Entrevista guiada</h2>
          {profile.template?.interviewQuestions.map((q: any) => (
            <div key={q.id}>
              <label className="text-xs text-ink-soft">{q.prompt}</label>
              <input
                defaultValue={data[q.fillsField] ?? ""}
                onBlur={(e) => handleFieldChange(q.fillsField, e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              />
            </div>
          ))}
          <button onClick={() => setStep(3)} className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
            Continuar
          </button>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-serif text-xl">Revisar e aprovar</h2>
          {profile.template?.fields.map((f: any) => (
            <div key={f.key} className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-sm">
              <div>
                <div>{f.label}</div>
                <div className="text-xs text-muted">{data[f.key] ?? "— não preenchido —"}</div>
              </div>
              <button
                onClick={() => handleApprove(f.key)}
                className={`rounded-full px-2 py-1 text-xs ${fieldStatus[f.key]?.approvedByOwner ? "bg-positive-soft text-positive" : "border border-border text-muted"}`}
              >
                {fieldStatus[f.key]?.approvedByOwner ? "Aprovado" : "Aprovar"}
              </button>
            </div>
          ))}
          <button onClick={() => { handleRecompute(); setStep(4); }} className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
            Continuar
          </button>
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-serif text-xl">Número de WhatsApp para escalonamento</h2>
          <p className="text-xs text-muted">Necessário para o chat conseguir passar um cliente para um atendente humano.</p>
          <div className="flex gap-2">
            <input value={waLabel} onChange={(e) => setWaLabel(e.target.value)} placeholder="Label" className="w-32 rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
            <input value={waPhone} onChange={(e) => setWaPhone(e.target.value)} placeholder="+55 11 99999-9999" className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm" />
            <button onClick={handleAddWhatsapp} className="rounded-lg border border-border px-3 py-2 text-xs">Adicionar</button>
          </div>
          {whatsappNumbers.map((n) => (
            <div key={n.id} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">{n.label}: {n.phone}</div>
          ))}
          <button onClick={() => setStep(5)} className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
            Continuar
          </button>
        </div>
      )}

      {step === 5 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-serif text-xl">Medidor de prontidão</h2>
          <div className="rounded-card border border-border bg-surface p-5 text-center">
            <div className="font-mono text-3xl">{business.confidenceScore}%</div>
            <div className="text-xs text-muted">
              {business.confidenceScore >= 70 ? "Pronto para publicar" : "Preencha os campos obrigatórios para chegar a 70%"}
            </div>
          </div>
          <button onClick={handleRecompute} className="self-start rounded-lg border border-border px-3 py-2 text-xs">Recalcular</button>

          {business.status !== "live" ? (
            <button
              onClick={handlePublish}
              disabled={business.confidenceScore < 70}
              className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            >
              Publicar
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
              <div className="text-sm">Seu link está pronto:</div>
              <code className="rounded bg-bg-2 px-2 py-1 text-xs">{publicUrl}</code>
              <button onClick={() => confirmLinkPlaced().then(refresh)} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
                Já coloquei o link na bio
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
