"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { interviewChat, uploadDocumentFile, getDocuments, updateWebsiteUrl } from "../lib/api";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { ShareLink } from "./ShareLink";

interface Message {
  role: "owner" | "clara";
  content: string;
}

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 60000;
const URL_PATTERN = /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i;

export function InterviewChat({
  onFieldFilled,
  prefill,
  prefillNonce,
  onStateChange,
  assistantName = "Clara",
}: {
  // Persona name used in the helper copy (the pharmacy niche's assistant is "Alex").
  assistantName?: string;
  onFieldFilled?: () => void;
  // When `prefillNonce` changes, `prefill` is sent as an owner message — used to target a specific
  // field from outside the chat. The nonce lets the same prefill text be re-sent (e.g. clicking
  // "Pedir à Clara" again on the same field).
  prefill?: string;
  prefillNonce?: number;
  onStateChange?: (s: { allDone: boolean; readyToPublish: boolean; confidenceScore: number | null }) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const [remainingGaps, setRemainingGaps] = useState<number | null>(null);
  const [confidenceScore, setConfidenceScore] = useState<number | null>(null);
  const [progress, setProgress] = useState<{ answered: number; total: number } | null>(null);
  const [readyToPublish, setReadyToPublish] = useState(false);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlInput, setUrlInput] = useState("");
  const [savingUrl, setSavingUrl] = useState(false);
  const [slow, setSlow] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);
  const lastPrefillNonce = useRef<number | undefined>(undefined);

  async function send(history: Message[]) {
    setSending(true);
    try {
      const result = await interviewChat(history);
      setMessages((prev) => [...prev, { role: "clara", content: result.reply }]);
      setAllDone(result.allDone);
      setRemainingGaps(result.remainingGaps);
      setConfidenceScore(typeof result.confidenceScore === "number" ? result.confidenceScore : null);
      setReadyToPublish(!!result.readyToPublish);
      if (typeof result.totalFields === "number" && typeof result.answeredFields === "number") setProgress({ answered: result.answeredFields, total: result.totalFields });
      setPublicUrl(result.publicUrl ?? null);
      if (onStateChange) {
        onStateChange({
          allDone: result.allDone,
          readyToPublish: !!result.readyToPublish,
          confidenceScore: typeof result.confidenceScore === "number" ? result.confidenceScore : null,
        });
      }
      if (onFieldFilled) onFieldFilled();
    } catch {
      setMessages((prev) => [...prev, { role: "clara", content: "Tive um problema para continuar — tenta de novo em instantes." }]);
    } finally {
      setSending(false);
    }
  }

  useEffect(() => {
    if (!sending) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), 6000);
    return () => clearTimeout(timer);
  }, [sending]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    send([]);
  }, []);

  useEffect(() => {
    if (!prefill || prefillNonce === undefined || prefillNonce === lastPrefillNonce.current) return;
    lastPrefillNonce.current = prefillNonce;
    if (!started.current) started.current = true;
    const next: Message[] = [...messages, { role: "owner", content: prefill }];
    setMessages(next);
    send(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, prefillNonce]);

  // requestAnimationFrame ensures this runs after layout settles (matches the pattern in
  // apps/chat/src/components/ChatScreen.tsx) — scrolling before the new message/bubble has
  // actually painted causes a visible jump/correction once layout catches up.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [messages, sending, uploadStatus, uploadError]);

  async function handleSend() {
    if (!input.trim() || sending) return;
    const text = input.trim();
    const next: Message[] = [...messages, { role: "owner", content: text }];
    setMessages(next);
    setInput("");
    if (URL_PATTERN.test(text) && !showUrlInput) {
      setUrlInput(text);
      setShowUrlInput(true);
    }
    await send(next);
  }

  function handleFileButtonClick() {
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploadError(null);
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError(`O arquivo "${file.name}" passa do limite de 20MB. Envie um arquivo menor.`);
      return;
    }

    setMessages((prev) => [...prev, { role: "owner", content: `📎 ${file.name}` }]);
    setUploadStatus(`${assistantName} está lendo…`);

    try {
      const uploaded = await uploadDocumentFile(file);
      const documentId = uploaded?.id;
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      let processed = false;

      while (Date.now() < deadline) {
        const documents = await getDocuments();
        const match = documentId ? documents.find((d: any) => d.id === documentId) : documents[0];
        if (match?.status === "processed") {
          processed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }

      if (!processed) {
        setUploadStatus(null);
        setUploadError(`Não consegui confirmar que "${file.name}" terminou de ser processado a tempo. Pode continuar a conversa — ${assistantName} vai usar o conteúdo assim que estiver pronto.`);
        return;
      }

      setUploadStatus(null);
      const next: Message[] = [...messages, { role: "owner", content: `📎 ${file.name}` }, { role: "owner", content: `Já mandei o arquivo "${file.name}", pode considerar o conteúdo dele.` }];
      setMessages(next);
      await send(next);
    } catch {
      setUploadStatus(null);
      setUploadError(`Não consegui enviar "${file.name}". Tenta de novo em instantes.`);
    }
  }

  async function handleSaveUrl() {
    if (!urlInput.trim() || savingUrl) return;
    setSavingUrl(true);
    setUploadError(null);
    try {
      await updateWebsiteUrl(urlInput.trim());
      setShowUrlInput(false);
      const next: Message[] = [...messages, { role: "clara", content: `Perfeito, salvei o site ${urlInput.trim()} — vou usar isso também.` }];
      setMessages(next);
      setUrlInput("");
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Não consegui salvar esse site. Confira se a URL está correta.");
    } finally {
      setSavingUrl(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex max-h-96 flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-bg-2 p-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "owner"
                ? "ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-accent px-3 py-2 text-sm text-white"
                : "max-w-[85%] rounded-xl rounded-bl-sm bg-surface px-3 py-2 text-sm text-ink"
            }
          >
            {m.content}
          </div>
        ))}
        {sending && (
          <div role="status" aria-live="polite" className="flex max-w-[85%] items-center gap-2 rounded-xl rounded-bl-sm bg-surface px-3 py-2">
            <span className="flex items-center gap-1" aria-hidden="true">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft" />
            </span>
            <span className="text-xs italic text-ink-soft">{assistantName} está pensando…{slow ? " isso pode levar alguns segundos" : ""}</span>
          </div>
        )}
        {uploadStatus && <p className="text-xs italic text-ink-soft">{uploadStatus}</p>}
        {uploadError && <p className="text-xs text-negative">{uploadError}</p>}
        <div ref={bottomRef} />
      </div>

      {readyToPublish && publicUrl && (
        <ShareLink slug={publicUrl.split("/").pop() ?? ""} showInstructions />
      )}

      {showUrlInput && !allDone && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg-2 p-3">
          <p className="text-xs text-ink-soft">Esse é o site do seu negócio? Posso salvar para {assistantName} usar também.</p>
          <div className="flex gap-2">
            <Input value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder="https://seusite.com.br" />
            <Button variant="outline" size="sm" onClick={handleSaveUrl} disabled={savingUrl || !urlInput.trim()}>
              Salvar site
            </Button>
          </div>
        </div>
      )}

      {!allDone && (
        <div className="flex gap-2">
          <input ref={fileInputRef} type="file" onChange={handleFileSelected} className="hidden" />
          <Button
            variant="outline"
            onClick={handleFileButtonClick}
            disabled={sending}
            aria-label="Enviar arquivo"
            className="px-3"
          >
            <Paperclip className="h-4 w-4" />
          </Button>
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="Digite sua resposta…"
            disabled={sending}
          />
          <Button onClick={handleSend} disabled={sending || !input.trim()}>Enviar</Button>
        </div>
      )}
      {remainingGaps !== null && (
        <div className="space-y-1.5" aria-live="polite">
          {progress && progress.total > 0 && (
            <div
              role="progressbar"
              aria-label="Progresso da conversa"
              aria-valuemin={0}
              aria-valuemax={progress.total}
              aria-valuenow={progress.answered}
              className="h-1.5 w-full overflow-hidden rounded-full bg-bg-2"
            >
              <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${Math.round((progress.answered / progress.total) * 100)}%` }} />
            </div>
          )}
          <p className="text-xs text-ink-soft">
            {allDone
              ? "Todos os campos foram cobertos."
              : progress
                ? `${progress.answered} de ${progress.total} informações respondidas · faltam ${remainingGaps}.`
                : `${remainingGaps} campo(s) ainda faltando.`}
            {confidenceScore ? ` Prontidão do atendimento: ${confidenceScore}%.` : ""}
          </p>
        </div>
      )}
    </div>
  );
}
