"use client";

import { useEffect, useState } from "react";
import {
  getMe,
  getOnboardingProfile,
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
import { InterviewChat } from "../../components/InterviewChat";
import { ShareLink } from "../../components/ShareLink";

export default function KnowledgePage() {
  const [business, setBusiness] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [unanswered, setUnanswered] = useState<any[]>([]);
  const [pastedText, setPastedText] = useState("");

  async function refresh() {
    setBusiness(await getMe());
    await getOnboardingProfile();
    setDocuments(await getDocuments());
    getUnanswered().then(setUnanswered).catch(() => setUnanswered([]));
  }

  useEffect(() => {
    refresh();
  }, []);

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

      <Card>
        <CardHeader>
          <CardTitle>Documentos</CardTitle>
          <CardDescription>Tudo que a Clara usa para responder seus clientes.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <input type="file" onChange={handleFileUpload} className="text-sm" />
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

      <Card>
        <CardHeader>
          <CardTitle>Conversar com a Clara</CardTitle>
          <CardDescription>Ela já sabe o que está nos documentos — só vai perguntar o que falta.</CardDescription>
        </CardHeader>
        <CardContent>
          <InterviewChat onFieldFilled={refresh} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Perguntas não respondidas</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {unanswered.map((q) => (
            <div key={q.id} className="rounded-lg border border-border bg-bg-2 px-3 py-2 text-sm">
              <div className="text-ink">{q.questionText}</div>
              <div className="mt-1 text-xs text-ink-soft">{q.occurrenceCount}x perguntado</div>
            </div>
          ))}
          {unanswered.length === 0 && <p className="text-sm text-ink-soft">Nenhuma pergunta pendente.</p>}
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

          {business.status !== "live" && (
            <Button disabled={business.confidenceScore < 70} onClick={handlePublish}>Publicar</Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
