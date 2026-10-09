"use client";

import { useEffect, useRef, useState } from "react";
import {
  getInboxConversations,
  getInboxThread,
  sendInboxMessage,
  markInboxRead,
  getLeadWhatsappLink,
} from "../../lib/api";
import { Card, CardContent } from "../../components/ui/card";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Textarea } from "../../components/ui/textarea";
import { SegmentedControl } from "../../components/ui/segmented";
import { playAlertSound } from "../../lib/alert-sound";
import { MessageMirror } from "../../components/MessageMirror";

const MUTE_STORAGE_KEY = "inbox-alert-muted";
const POLL_INTERVAL_MS = 15000;

const STATUS_LABEL: Record<string, string> = {
  active: "Ativa",
  idle: "Ociosa",
  escalated: "Escalada",
  closed: "Encerrada",
};

const STATUS_VARIANT: Record<string, "neutral" | "positive" | "negative" | "warning" | "tertiary"> = {
  active: "tertiary",
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
  const [muted, setMuted] = useState(false);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const lastThreadIdRef = useRef<string | null>(null);
  const lastMessageCountRef = useRef(0);
  const liveAttentionSeenRef = useRef<Set<string>>(new Set());
  const hasLoadedOnceRef = useRef(false);

  // Sound always defaults to ON on page load — intentionally not restored from
  // MUTE_STORAGE_KEY here, so a mute from a previous visit never silently carries over.
  // toggleMuted still persists the in-session choice below, for parity/debugging, but it's
  // not read back on mount.

  function toggleMuted() {
    const next = !muted;
    setMuted(next);
    try {
      localStorage.setItem(MUTE_STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Ignore storage failures.
    }
    if (!next) {
      // Unmuting is also the user gesture that unlocks audio autoplay for this session.
      try {
        playAlertSound();
      } catch {
        // Ignore audio failures.
      }
    }
  }

  function notifyNewLiveAttention(list: any[]) {
    const currentIds = new Set(list.filter((c) => c.needsLiveAttention).map((c) => c.id));
    if (hasLoadedOnceRef.current) {
      let hasNew = false;
      for (const id of currentIds) {
        if (!liveAttentionSeenRef.current.has(id)) hasNew = true;
      }
      if (hasNew && !muted) {
        try {
          playAlertSound();
        } catch {
          // Don't let a sound failure break the page.
        }
      }
    }
    liveAttentionSeenRef.current = currentIds;
    hasLoadedOnceRef.current = true;
  }

  async function refresh() {
    setLoading(true);
    try {
      const data = await getInboxConversations(filter);
      setConversations(data);
      notifyNewLiveAttention(data);
    } finally {
      setLoading(false);
    }
  }

  async function poll() {
    try {
      const data = await getInboxConversations(filter);
      setConversations(data);
      notifyNewLiveAttention(data);
    } catch {
      // Silent refresh — don't disrupt the UI on transient poll failures.
    }
  }

  // On first load, default to "Precisam de resposta" only if it actually has results —
  // otherwise there's nothing to triage there and "Todas" is the more useful default.
  useEffect(() => {
    getInboxConversations("escalated")
      .then((data) => {
        if (!data || data.length === 0) setFilter("all");
      })
      .catch(() => {
        // Ignore — keep the default filter and let the normal refresh/poll below surface errors.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refresh();
    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function selectConversation(id: string) {
    setSelectedId(id);
    // Clear the previously loaded thread synchronously so there's no render where `selectedId`
    // points at the new conversation while `thread` still holds the old one's data — the
    // scroll effect below keys identity off `thread.id`, not `selectedId`, specifically to avoid
    // that desync window.
    setThread(null);
    const data = await getInboxThread(id);
    setThread(data);
    await markInboxRead(id);
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread: false } : c)));
  }

  // Container-only scrolling (never scrollIntoView, which would also scroll the outer page
  // <main>) — an identity change (conversation switch/open) snaps the thread's own scrollbar to
  // the bottom instantly; a message-count increase within the same conversation scrolls smoothly.
  // Mirrors the requestAnimationFrame pattern in InterviewChat.tsx.
  useEffect(() => {
    const identityKey = thread?.id ?? null;
    const count = thread?.messages?.length ?? 0;
    const isNewConversation = identityKey !== lastThreadIdRef.current;
    const frame = requestAnimationFrame(() => {
      const el = messageListRef.current;
      if (!el) return;
      if (isNewConversation) {
        el.scrollTop = el.scrollHeight;
      } else if (count > lastMessageCountRef.current) {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }
      // Refs only advance after real DOM scroll work above actually ran — if the element isn't
      // mounted yet (e.g. first-ever open, while `thread` is still null) this frame no-ops via
      // the guard above and bookkeeping is left untouched, so the next real frame still sees it
      // as "new conversation" and snaps instead of incorrectly scrolling smoothly.
      lastThreadIdRef.current = identityKey;
      lastMessageCountRef.current = count;
    });
    return () => cancelAnimationFrame(frame);
  }, [thread?.id, thread?.messages?.length]);

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
  const selectedConversation = conversations.find((c) => c.id === selectedId);
  const selectedLeadId = selectedConversation?.lead?.id as string | undefined;

  async function handleOpenWhatsapp() {
    if (!selectedLeadId) return;
    try {
      const { url } = await getLeadWhatsappLink(selectedLeadId, "Retorno de contato solicitado no chat");
      window.open(url, "_blank", "noopener");
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erro ao abrir o WhatsApp.");
    }
  }

  function presenceLabel(c: any) {
    if (c.visitorOnline) return { dotClass: "bg-emerald-500", label: "Online agora" };
    if (c.lastVisitorSeenAt) return { dotClass: "bg-ink-soft/40", label: `visto ${relativeTime(c.lastVisitorSeenAt)}` };
    return { dotClass: "bg-ink-soft/40", label: "sem atividade" };
  }

  const liveAttentionConversations = conversations.filter((c) => c.needsLiveAttention);
  const otherConversations = conversations.filter((c) => !c.needsLiveAttention);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-serif text-2xl text-ink">Conversas</h1>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            value={filter}
            onValueChange={(v) => setFilter(v)}
            options={[
              { label: "Precisam de resposta", value: "escalated" },
              { label: "Todas", value: "all" },
            ]}
          />
          <Button size="sm" variant="outline" onClick={toggleMuted}>
            {muted ? "Som desativado" : "Som ativado"}
          </Button>
          <Button size="sm" variant="outline" onClick={refresh}>
            Atualizar
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[320px_1fr] xl:grid-cols-[340px_1fr]">
        <div className="flex flex-col gap-3">
          {liveAttentionConversations.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold uppercase text-accent-ink">Precisam de você agora</h2>
              {liveAttentionConversations.map((c) => {
                const presence = presenceLabel(c);
                return (
                  <Card
                    key={c.id}
                    className={`cursor-pointer border-l-4 border-l-accent transition-colors ${
                      selectedId === c.id ? "border-accent" : ""
                    }`}
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
                      <div className="flex items-center gap-1.5 text-xs text-ink-soft">
                        <span className={`h-1.5 w-1.5 rounded-full ${presence.dotClass}`} aria-hidden />
                        <span>{presence.label}</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-xs text-ink-soft">{c.preview}</p>
                        <Badge variant="negative">
                          {c.escalationReason === "callback" ? "Pediu ligação" : "Aguardando você"}
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          <div className="flex flex-col gap-2">
            {otherConversations.map((c) => {
              const presence = presenceLabel(c);
              return (
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
                    <div className="flex items-center gap-1.5 text-xs text-ink-soft">
                      <span className={`h-1.5 w-1.5 rounded-full ${presence.dotClass}`} aria-hidden />
                      <span>{presence.label}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs text-ink-soft">{c.preview}</p>
                      <Badge variant={STATUS_VARIANT[c.status]}>{STATUS_LABEL[c.status]}</Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
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
                <div ref={messageListRef} className="flex-1 overflow-y-auto pr-1">
                  <div className="flex flex-col gap-2">
                    {thread.messages.map((m: any) =>
                      m.role === "assistant" ? (
                        <div key={m.id} className="flex justify-start">
                          <div className="max-w-[92%]">
                            <MessageMirror message={m} personaName={thread.personaName ?? "Assistente"} niche={thread.niche} />
                          </div>
                        </div>
                      ) : (
                        <div key={m.id} className={`flex ${m.role === "owner" ? "justify-end" : "justify-start"}`}>
                          <div
                            className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                              m.role === "owner" ? "bg-accent text-white" : "bg-surface text-ink"
                            }`}
                          >
                            <div className="whitespace-pre-wrap">{m.content}</div>
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                </div>

                <div className="mt-3 border-t border-border pt-3">
                  {canReply ? (
                    <div className="flex flex-col gap-2">
                      {thread.visitorOnline === false && (
                        <p className="text-xs text-ink-soft">
                          O visitante saiu do chat — use WhatsApp ou telefone para continuar.
                        </p>
                      )}
                      <Textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Escreva sua resposta..."
                        rows={2}
                        disabled={sending}
                      />
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={handleOpenWhatsapp} disabled={!selectedLeadId}>
                          Abrir WhatsApp
                        </Button>
                        <Button size="sm" onClick={handleSend} disabled={sending || !text.trim()}>
                          Enviar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <p className="text-xs text-ink-soft">
                        Só é possível responder conversas escaladas para atendimento humano.
                      </p>
                      <div className="flex justify-end">
                        <Button size="sm" variant="outline" onClick={handleOpenWhatsapp} disabled={!selectedLeadId}>
                          Abrir WhatsApp
                        </Button>
                      </div>
                    </div>
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
