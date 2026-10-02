"use client";

import { useRef, useState } from "react";
import { askOwnerAssistant, patchProfileField } from "../../lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

interface Message {
  role: "owner" | "assistant";
  content: string;
}

interface PendingProposal {
  fieldKey: string;
  proposedValue: string;
  reason: string;
}

export default function AssistantPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingProposal, setPendingProposal] = useState<PendingProposal | null>(null);
  const [proposalDone, setProposalDone] = useState<"confirmed" | "rejected" | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function handleSend() {
    if (!input.trim() || sending) return;
    const text = input.trim();
    const next: Message[] = [...messages, { role: "owner", content: text }];
    setMessages(next);
    setInput("");
    setSending(true);
    setPendingProposal(null);
    setProposalDone(null);
    try {
      const result = await askOwnerAssistant(text, messages);
      setMessages((prev) => [...prev, { role: "assistant", content: result.reply }]);
      if (result.pendingProposal) setPendingProposal(result.pendingProposal);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Tive um problema para responder — tenta de novo em instantes." }]);
    } finally {
      setSending(false);
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }

  async function handleConfirmProposal() {
    if (!pendingProposal) return;
    await patchProfileField(pendingProposal.fieldKey, pendingProposal.proposedValue, "manual");
    setProposalDone("confirmed");
    setPendingProposal(null);
  }

  function handleRejectProposal() {
    setProposalDone("rejected");
    setPendingProposal(null);
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="font-serif text-2xl text-ink">Assistente do dono</h1>
        <p className="text-sm text-ink-soft">Pergunte sobre leads, métricas e a base de conhecimento do seu negócio.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Conversar</CardTitle>
          <CardDescription>Ele só responde sobre o seu negócio, usando ferramentas restritas — nunca escreve nada sem sua confirmação.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex max-h-96 min-h-48 flex-col gap-2 overflow-y-auto rounded-lg border border-border bg-bg-2 p-3">
            {messages.length === 0 && (
              <p className="text-sm text-ink-soft">
                Experimente perguntar: "Quantos leads eu tenho?" ou "Como estão minhas conversas nos últimos 7 dias?"
              </p>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "owner"
                    ? "ml-auto max-w-[85%] rounded-xl rounded-br-sm bg-accent px-3 py-2 text-sm text-white"
                    : "max-w-[85%] whitespace-pre-line rounded-xl rounded-bl-sm bg-surface px-3 py-2 text-sm text-ink"
                }
              >
                {m.content}
              </div>
            ))}
            {sending && (
              <div className="flex max-w-[60%] items-center gap-1 rounded-xl rounded-bl-sm bg-surface px-3 py-2">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft" />
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {pendingProposal && (
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-bg-2 p-3 text-sm">
              <div className="font-semibold text-ink">Proposta de alteração de perfil</div>
              <div className="text-ink-soft">
                Campo: <span className="text-ink">{pendingProposal.fieldKey}</span>
              </div>
              <div className="text-ink-soft">
                Novo valor: <span className="text-ink">{pendingProposal.proposedValue}</span>
              </div>
              {pendingProposal.reason && <div className="text-xs text-ink-soft">Motivo: {pendingProposal.reason}</div>}
              <div className="flex gap-2">
                <Button size="sm" onClick={handleConfirmProposal}>Confirmar</Button>
                <Button size="sm" variant="outline" onClick={handleRejectProposal}>Rejeitar</Button>
              </div>
            </div>
          )}
          {proposalDone === "confirmed" && <p className="text-xs text-positive">Alteração aplicada.</p>}
          {proposalDone === "rejected" && <p className="text-xs text-ink-soft">Proposta descartada.</p>}

          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="Digite sua pergunta…"
              disabled={sending}
            />
            <Button onClick={handleSend} disabled={sending || !input.trim()}>Enviar</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
