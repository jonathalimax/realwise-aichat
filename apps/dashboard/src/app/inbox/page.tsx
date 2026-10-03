"use client";

import { useEffect, useRef, useState } from "react";
import { getInboxConversations, getInboxThread, sendInboxMessage, markInboxRead } from "../../lib/api";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { SegmentedControl } from "../../components/ui/segmented";

const STATUS_LABEL: Record<string, string> = {
  active: "Ativa",
  idle: "Ociosa",
  escalated: "Escalada",
  closed: "Encerrada",
};

const STATUS_VARIANT: Record<string, "neutral" | "positive" | "negative" | "warning"> = {
  active: "neutral",
  idle: "neutral",
  escalated: "warning",
  closed: "neutral",
};

export default function InboxPage() {
  const [filter, setFilter] = useState<"escalated" | "all">("escalated");
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [thread, setThread] = useState<any | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const threadEndRef = useRef<HTMLDivElement | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      setConversations(await getInboxConversations(filter));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function selectConversation(id: string) {
    setSelectedId(id);
    const data = await getInboxThread(id);
    setThread(data);
    await markInboxRead(id);
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread: false } : c)));
  }

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread?.messages?.length]);

  async function handleSend() {
    if (!selectedId || !text.trim() || sending) return;
    setSending(true);
    try {
      await sendInboxMessage(selectedId, text.trim());
      setText("");
      const data = await getInboxThread(selectedId);
      setThread(data);
      refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao enviar mensagem.");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function relativeTime(dateStr: string) {
    const date = new Date(dateStr);
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 1) return "agora";
    if (diffMin < 60) return `há ${diffMin} min`;
    const diffH = Math.round(diffMin / 60);
    if (diffH < 24) return `há ${diffH} h`;
    const diffD = Math.round(diffH / 24);
    return `há ${diffD} d`;
  }

  const canReply = thread?.status === "escalated";

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <h1 className="font-serif text-2xl text-ink">Conversas</h1>
        <div className="flex items-center gap-2">
          <SegmentedControl
            value={filter}
            onValueChange={(v) => setFilter(v)}
            options={[
              { label: "Precisam de resposta", value: "escalated" },
              { label: "Todas", value: "all" },
            ]}
          />
          <Button size="sm" variant="outline" onClick={refresh}>
            Atualizar
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <div className="flex flex-col gap-2">
          {conversations.map((c) => (
            <Card
              key={c.id}
              className={`cursor-pointer transition-colors ${selectedId === c.id ? "border-accent" : ""}`}
              onClick={() => selectConversation(c.id)}
            >
              <CardContent className="flex flex-col gap-1 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {c.unread && <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />}
                    <span className="text-sm font-semibold text-ink">{c.lead?.name || "Visitante"}</span>
                  </div>
                  <span className="text-xs text-ink-soft">{relativeTime(c.lastMessageAt)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs text-ink-soft">{c.preview}</p>
                  <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                </div>
              </CardContent>
            </Card>
          ))}
          {!loading && conversations.length === 0 && (
            <p className="text-sm text-ink-soft">
              {filter === "escalated" ? "Nenhuma conversa precisa de resposta agora." : "Nenhuma conversa ainda."}
            </p>
          )}
        </div>

        <Card className="flex flex-col">
          <CardContent className="flex h-[70vh] flex-col p-4">
            {!thread ? (
              <div className="flex flex-1 items-center justify-center text-sm text-ink-soft">
                Selecione uma conversa para ver o histórico.
              </div>
            ) : (
              <>
                <div className="flex-1 overflow-y-auto pr-1">
                  <div className="flex flex-col gap-2">
                    {thread.messages.map((m: any) => (
                      <div
                        key={m.id}
                        className={`flex ${m.role === "owner" ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                            m.role === "owner"
                              ? "bg-accent text-white"
                              : m.role === "assistant"
                                ? "bg-accent-soft text-ink"
                                : "bg-surface text-ink"
                          }`}
                        >
                          {m.role === "assistant" && (
                            <div className="mb-0.5 text-[0.65rem] font-semibold uppercase text-accent-ink">Clara</div>
                          )}
                          <div className="whitespace-pre-wrap">{m.content}</div>
                        </div>
                      </div>
                    ))}
                    <div ref={threadEndRef} />
                  </div>
                </div>

                <div className="mt-3 border-t border-border pt-3">
                  {canReply ? (
                    <div className="flex flex-col gap-2">
                      <Textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Escreva sua resposta..."
                        rows={2}
                        disabled={sending}
                      />
                      <div className="flex justify-end">
                        <Button size="sm" onClick={handleSend} disabled={sending || !text.trim()}>
                          Enviar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-ink-soft">
                      Só é possível responder conversas escaladas para atendimento humano.
                    </p>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
