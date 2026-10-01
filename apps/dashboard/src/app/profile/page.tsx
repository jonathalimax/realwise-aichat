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
} from "../../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";

export default function ProfilePage() {
  const [business, setBusiness] = useState<any>(null);
  const [slug, setSlug] = useState("");
  const [slugStatus, setSlugStatus] = useState<"idle" | "available" | "taken">("idle");
  const [profile, setProfile] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [whatsappNumbers, setWhatsappNumbers] = useState<any[]>([]);
  const [waLabel, setWaLabel] = useState("Principal");
  const [waPhone, setWaPhone] = useState("");
  const [savedInfo, setSavedInfo] = useState(false);

  async function refresh() {
    const b = await getMe();
    setBusiness(b);
    setSlug(b.slug?.startsWith("pending-") ? "" : b.slug);
    setProfile(await getOnboardingProfile());
    setDocuments(await getDocuments());
    setWhatsappNumbers(await getWhatsappNumbers());
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCheckSlug() {
    setSlugStatus((await checkSlugAvailable(slug)) ? "available" : "taken");
  }

  async function saveBusinessInfo() {
    await updateBusiness({ name: business.name, ownerName: business.ownerName, email: business.email, niche: business.niche });
    if (slug && slug !== business.slug && slugStatus === "available") await setBusinessSlug(slug);
    setSavedInfo(true);
    setTimeout(() => setSavedInfo(false), 2000);
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
    refresh();
  }

  if (!business || !profile) return <p className="text-ink-soft">Carregando…</p>;

  const data = profile.profile?.data ?? {};
  const fieldStatus = profile.profile?.fieldStatus ?? {};
  const publicUrl = `${process.env.NEXT_PUBLIC_CHAT_URL ?? "http://localhost:3005"}/${business.slug}`;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl text-ink">Perfil do negócio</h1>
        <Badge variant={business.confidenceScore >= 70 ? "positive" : "warning"}>
          Prontidão: {business.confidenceScore}%
        </Badge>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Sobre o negócio</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <input
            value={business.name}
            onChange={(e) => setBusiness({ ...business, name: e.target.value })}
            placeholder="Nome do negócio"
            className="rounded-lg border border-border bg-bg-2 px-3 py-2 text-sm"
          />
          <input
            value={business.ownerName}
            onChange={(e) => setBusiness({ ...business, ownerName: e.target.value })}
            placeholder="Seu nome"
            className="rounded-lg border border-border bg-bg-2 px-3 py-2 text-sm"
          />
          <input
            value={business.email ?? ""}
            onChange={(e) => setBusiness({ ...business, email: e.target.value })}
            placeholder="Seu e-mail"
            type="email"
            className="rounded-lg border border-border bg-bg-2 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <input
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugStatus("idle");
              }}
              placeholder="seu-link"
              className="flex-1 rounded-lg border border-border bg-bg-2 px-3 py-2 text-sm"
            />
            <Button variant="outline" size="sm" onClick={handleCheckSlug}>Verificar</Button>
          </div>
          {slugStatus === "available" && <p className="text-xs text-positive">Disponível!</p>}
          {slugStatus === "taken" && <p className="text-xs text-negative">Já em uso.</p>}
          <Button className="self-start" onClick={saveBusinessInfo}>{savedInfo ? "Salvo!" : "Salvar"}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Documentos</CardTitle>
          <CardDescription>Tudo que a Clara usa para responder seus clientes.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <input type="file" onChange={handleFileUpload} className="text-sm" />
          <textarea
            value={pastedText}
            onChange={(e) => setPastedText(e.target.value)}
            placeholder="Ou cole aqui um texto (tabela de preços, horários, políticas…)"
            rows={4}
            className="rounded-lg border border-border bg-bg-2 px-3 py-2 text-sm"
          />
          <Button variant="outline" size="sm" className="self-start" onClick={handlePasteText}>Adicionar texto</Button>
          <div className="flex flex-col gap-1">
            {documents.map((d) => (
              <div key={d.id} className="flex justify-between rounded-lg border border-border bg-bg-2 px-3 py-2 text-xs">
                <span>{d.filename}</span>
                <span className="text-ink-soft">{d.status}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Entrevista</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {profile.template?.interviewQuestions.map((q: any) => (
            <div key={q.id}>
              <label className="text-xs text-ink-soft">{q.prompt}</label>
              <input
                defaultValue={data[q.fillsField] ?? ""}
                onBlur={(e) => handleFieldChange(q.fillsField, e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-bg-2 px-3 py-2 text-sm"
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Revisar e aprovar campos</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {profile.template?.fields.map((f: any) => (
            <div key={f.key} className="flex items-center justify-between rounded-lg border border-border bg-bg-2 px-3 py-2 text-sm">
              <div>
                <div className="text-ink">{f.label}</div>
                <div className="text-xs text-ink-soft">{data[f.key] ?? "— não preenchido —"}</div>
              </div>
              <Button
                size="sm"
                variant={fieldStatus[f.key]?.approvedByOwner ? "default" : "outline"}
                onClick={() => handleApprove(f.key)}
              >
                {fieldStatus[f.key]?.approvedByOwner ? "Aprovado" : "Aprovar"}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>WhatsApp para escalonamento</CardTitle>
          <CardDescription>Necessário para o chat conseguir passar um cliente para um atendente humano.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <input value={waLabel} onChange={(e) => setWaLabel(e.target.value)} placeholder="Label" className="w-32 rounded-lg border border-border bg-bg-2 px-3 py-2 text-sm" />
            <input value={waPhone} onChange={(e) => setWaPhone(e.target.value)} placeholder="(11) 99999-9999" className="flex-1 rounded-lg border border-border bg-bg-2 px-3 py-2 text-sm" />
            <Button variant="outline" size="sm" onClick={handleAddWhatsapp}>Adicionar</Button>
          </div>
          {whatsappNumbers.map((n) => (
            <div key={n.id} className="rounded-lg border border-border bg-bg-2 px-3 py-2 text-sm">{n.label}: {n.phone}</div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Medidor de prontidão</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="rounded-card border border-border bg-bg-2 p-5 text-center">
            <div className="font-mono text-3xl text-ink">{business.confidenceScore}%</div>
            <div className="text-xs text-ink-soft">
              {business.confidenceScore >= 70 ? "Pronto para publicar" : "Preencha os campos obrigatórios para chegar a 70%"}
            </div>
          </div>
          <Button variant="outline" size="sm" className="self-start" onClick={handleRecompute}>Recalcular</Button>

          {business.status !== "live" ? (
            <Button disabled={business.confidenceScore < 70} onClick={handlePublish}>Publicar</Button>
          ) : (
            <div className="flex flex-col gap-2 rounded-card border border-border bg-bg-2 p-4">
              <div className="text-sm text-ink">Seu link está pronto:</div>
              <code className="rounded bg-surface px-2 py-1 text-xs">{publicUrl}</code>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
