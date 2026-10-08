"use client";

import { useEffect, useRef, useState } from "react";
import {
  getMe,
  getOnboardingProfile,
  patchProfileField,
  approveProfileField,
  recomputeConfidence,
  uploadDocumentFile,
  uploadDocumentText,
  getDocuments,
  getUnanswered,
  publishBusiness,
} from "../../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Textarea } from "../../components/ui/textarea";
import { SegmentedControl } from "../../components/ui/segmented";
import { questionForField } from "@realwise/profile-schema";
import { InterviewChat } from "../../components/InterviewChat";
import { ShareLink } from "../../components/ShareLink";

const SECTION_OPTIONS = [
  { label: "Conversar com a Clara", value: "chat" },
  { label: "Documentos", value: "documents" },
  { label: "Informações salvas", value: "profile" },
  { label: "Perguntas não respondidas", value: "unanswered" },
] as const;

export default function KnowledgePage() {
  const [section, setSection] = useState<(typeof SECTION_OPTIONS)[number]["value"]>("chat");
  const [business, setBusiness] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [unanswered, setUnanswered] = useState<any[]>([]);
  const [pastedText, setPastedText] = useState("");
  const [correctionTarget, setCorrectionTarget] = useState<string | null>(null);
  const [correctionNonce, setCorrectionNonce] = useState(0);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  async function refresh() {
    setBusiness(await getMe());
    setProfile(await getOnboardingProfile());
    setDocuments(await getDocuments());
    getUnanswered().then(setUnanswered).catch(() => setUnanswered([]));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFileName(file.name);
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

  async function handleFieldChange(fieldKey: string, value: string) {
    await patchProfileField(fieldKey, value, "manual");
    setProfile(await getOnboardingProfile());
  }

  async function handleSaveDraft(fieldKey: string) {
    await handleFieldChange(fieldKey, draft);
    setEditingField(null);
    setDraft("");
  }

  async function handleApprove(fieldKey: string) {
    await approveProfileField(fieldKey);
    setProfile(await getOnboardingProfile());
  }

  async function handlePublish() {
    await publishBusiness();
    refresh();
  }

  if (!business) return <p className="text-ink-soft">Carregando…</p>;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="font-serif text-2xl text-ink">Base de conhecimento</h1>
        <Badge variant={business.confidenceScore >= 70 ? "positive" : "warning"}>
          Prontidão: {business.confidenceScore}%
        </Badge>
      </div>

      {business.status === "live" && <ShareLink slug={business.slug} />}

      <SegmentedControl value={section} onValueChange={setSection} options={SECTION_OPTIONS} className="self-start" />

      {section === "chat" && (
        <Card>
          <CardHeader>
            <CardTitle>Conversar com a Clara</CardTitle>
            <CardDescription>Ela já sabe o que está nos documentos — só vai perguntar o que falta.</CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <InterviewChat onFieldFilled={refresh} prefill={correctionTarget ?? undefined} prefillNonce={correctionNonce} />
          </CardContent>
        </Card>
      )}

      {section === "documents" && (
        <Card>
          <CardHeader>
            <CardTitle>Documentos</CardTitle>
            <CardDescription>Tudo que a Clara usa para responder seus clientes.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                Escolher arquivo
              </Button>
              <span className="text-sm text-ink-soft">{selectedFileName ?? "Nenhum arquivo selecionado."}</span>
            </div>
            <Textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Ou cole aqui um texto (tabela de preços, horários, políticas…)"
              rows={4}
            />
            <Button variant="outline" size="sm" className="self-start" onClick={handlePasteText}>Adicionar texto</Button>
            <div className="flex flex-col gap-1">
              {documents.map((d) => (
                <div key={d.id} className="flex justify-between rounded-lg border border-border bg-bg-2 px-3 py-2 text-xs">
                  <span>{d.filename}</span>
                  <span className="text-ink-soft">{d.status}</span>
                </div>
              ))}
              {documents.length === 0 && <p className="text-sm text-ink-soft">Nenhum documento enviado ainda.</p>}
            </div>
          </CardContent>
        </Card>
      )}

      {section === "profile" && (
        <Card>
          <CardHeader>
            <CardTitle>Informações salvas</CardTitle>
            <CardDescription>Confira o que a Clara sabe sobre o negócio e corrija se algo estiver errado.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-0">
            {profile?.template?.fields.map((f: any) => {
              const value = profile.profile?.data?.[f.key] ?? "";
              const approved = profile.profile?.fieldStatus?.[f.key]?.approvedByOwner;
              const question = questionForField(profile.template, f.key) ?? f.label;
              const isEditing = editingField === f.key;
              return (
                <div key={f.key} className="flex flex-col gap-2 rounded-lg border border-border bg-bg-2 px-3 py-3 text-sm">
                  <div className="text-sm text-ink">{question}</div>
                  {isEditing ? (
                    <div className="flex flex-col gap-2">
                      <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleSaveDraft(f.key)}>Salvar</Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingField(null);
                            setDraft("");
                          }}
                        >
                          Cancelar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-sm text-ink">
                      {value || <span className="text-ink-soft">— não respondido ainda —</span>}
                    </p>
                  )}
                  {!isEditing && (
                    <div className="flex flex-wrap gap-2">
                      {approved ? (
                        <Badge variant="positive">Aprovado</Badge>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => handleApprove(f.key)}>
                          Confirmar
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingField(f.key);
                          setDraft(value);
                        }}
                      >
                        Corrigir
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setCorrectionTarget(`Quero corrigir o campo "${f.label}".`);
                          setCorrectionNonce((n) => n + 1);
                          setSection("chat");
                        }}
                      >
                        Pedir à Clara
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
            {!profile?.template?.fields.length && <p className="text-sm text-ink-soft">Nenhum campo cadastrado ainda.</p>}
          </CardContent>
        </Card>
      )}

      {section === "unanswered" && (
        <Card>
          <CardHeader>
            <CardTitle>Perguntas não respondidas</CardTitle>
            <CardDescription>Assuntos que clientes perguntaram e a Clara ainda não sabe responder.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 pt-0">
            {unanswered.map((q) => (
              <div key={q.id} className="rounded-lg border border-border bg-bg-2 px-3 py-2 text-sm">
                <div className="text-ink">{q.questionText}</div>
                <div className="mt-1 text-xs text-ink-soft">{q.occurrenceCount}x perguntado</div>
              </div>
            ))}
            {unanswered.length === 0 && <p className="text-sm text-ink-soft">Nenhuma pergunta pendente.</p>}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Medidor de prontidão</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pt-0">
          <div className="rounded-card border border-border bg-bg-2 p-5 text-center">
            <div className="font-mono text-3xl text-ink">{business.confidenceScore}%</div>
            <div className="text-xs text-ink-soft">
              {business.confidenceScore >= 70 ? "Pronto para ativar seu link" : "Preencha os campos obrigatórios para chegar a 70%"}
            </div>
          </div>
          <Button variant="outline" size="sm" className="self-start" onClick={handleRecompute}>Recalcular</Button>

          {business.status !== "live" && (
            <Button disabled={business.confidenceScore < 70} onClick={handlePublish}>Ativar meu link</Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
