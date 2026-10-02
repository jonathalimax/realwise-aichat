"use client";

import { useEffect, useRef, useState } from "react";
import { maskBrPhone } from "@realwise/shared";
import { getBusiness, startConversation, streamMessage, bookAppointment, identifyVisitor, startFlow, advanceFlow } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent } from "./ui/card";

interface FlowBubble {
  label: string;
  goto: string;
  params?: Record<string, unknown>;
}

interface Message {
  id: string;
  role: "visitor" | "assistant";
  content: string;
}

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;
const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp)(\?\S*)?$/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov)(\?\S*)?$/i;

function MessageContent({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN);
  return (
    <>
      {parts.map((part, i) => {
        if (!URL_PATTERN.test(part)) {
          URL_PATTERN.lastIndex = 0;
          return <span key={i}>{part}</span>;
        }
        URL_PATTERN.lastIndex = 0;
        if (IMAGE_EXTENSIONS.test(part)) {
          return <img key={i} src={part} alt="" className="mt-2 max-h-56 w-full rounded-xl object-cover" />;
        }
        if (VIDEO_EXTENSIONS.test(part)) {
          return <video key={i} src={part} controls className="mt-2 max-h-56 w-full rounded-xl" />;
        }
        return (
          <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="underline">
            {part}
          </a>
        );
      })}
    </>
  );
}

let messageIdCounter = 0;
function nextMessageId() {
  messageIdCounter += 1;
  return `m${messageIdCounter}`;
}

export function ChatScreen({ slug }: { slug: string }) {
  const [business, setBusiness] = useState<any>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [bubbles, setBubbles] = useState<FlowBubble[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showBooking, setShowBooking] = useState(false);
  const [bookingDate, setBookingDate] = useState("");
  const [bookingTime, setBookingTime] = useState("");
  const [bookingName, setBookingName] = useState("");
  const [bookingPhone, setBookingPhone] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getBusiness(slug).then(setBusiness).catch(() => setBusiness(null));
  }, [slug]);

  useEffect(() => {
    if (!business) return;
    ensureConversation();
  }, [business]);

  useEffect(() => {
    if (!business || !conversationId) return;
    startFlow(business.id, conversationId)
      .then((result) => {
        setMessages((prev) => (prev.length === 0 ? [{ id: nextMessageId(), role: "assistant", content: result.message }] : prev));
        setBubbles(result.bubbles ?? []);
      })
      .catch(() => {});
  }, [business, conversationId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, showBooking, sending]);

  async function ensureConversation() {
    if (conversationId || !business) return conversationId;
    const conversation = await startConversation(business.id);
    setConversationId(conversation.id);
    return conversation.id;
  }

  async function handleSend(text: string) {
    if (!text.trim() || !business) return;
    if (text.toLowerCase().includes("agendar")) {
      setMessages((prev) => [...prev, { id: nextMessageId(), role: "visitor", content: text }]);
      setInput("");
      await ensureConversation();
      setShowBooking(true);
      return;
    }

    setShowBooking(false);
    setSending(true);
    setMessages((prev) => [...prev, { id: nextMessageId(), role: "visitor", content: text }]);
    setInput("");

    const assistantId = nextMessageId();
    let assistantStarted = false;
    try {
      const convId = await ensureConversation();
      const result = await streamMessage(business.id, convId, text, (delta) => {
        setSending(false);
        setMessages((prev) => {
          if (!assistantStarted) return [...prev, { id: assistantId, role: "assistant", content: delta }];
          return prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m));
        });
        assistantStarted = true;
      });
      if (result?.escalated && result?.whatsappUrl) {
        window.open(result.whatsappUrl, "_blank");
      } else if (result?.flow?.bubbles) {
        setBubbles(result.flow.bubbles);
      }
    } catch {
      setMessages((prev) => [...prev, { id: nextMessageId(), role: "assistant", content: "Tive um problema para responder — tenta de novo em instantes." }]);
    } finally {
      setSending(false);
    }
  }

  async function handleBubbleTap(bubble: FlowBubble) {
    if (!business) return;
    const isBack = bubble.goto === "__back__";

    // Back is pure local navigation — it replays an already-seen step, so it must not look like
    // the visitor sent a new message or that Clara is generating a reply.
    if (!isBack) {
      setMessages((prev) => [...prev, { id: nextMessageId(), role: "visitor", content: bubble.label }]);
      setSending(true);
    }
    try {
      const convId = await ensureConversation();
      const result = await advanceFlow(business.id, convId, bubble.goto, bubble.params);
      if (isBack) {
        setMessages((prev) => prev.slice(0, -2));
      } else {
        setMessages((prev) => [...prev, { id: nextMessageId(), role: "assistant", content: result.message }]);
      }
      setBubbles(result.bubbles ?? []);
    } finally {
      setSending(false);
    }
  }

  async function confirmBooking() {
    if (!conversationId || !bookingDate || !bookingTime || !bookingName || !bookingPhone) return;
    await identifyVisitor(slug, bookingName, bookingPhone);
    const startsAt = new Date(`${bookingDate}T${bookingTime}:00`);
    const endsAt = new Date(startsAt.getTime() + 30 * 60 * 1000);
    const serviceName = business.niche === "imobiliaria" ? "Visita ao imóvel" : "Test-drive";
    await bookAppointment(business.id, conversationId, serviceName, startsAt.toISOString(), endsAt.toISOString());
    setMessages((prev) => [
      ...prev,
      { id: nextMessageId(), role: "assistant", content: `Agendado: ${serviceName} em ${startsAt.toLocaleDateString("pt-BR")} às ${bookingTime}. Vamos confirmar com você em breve.` },
    ]);
    setShowBooking(false);
  }

  if (!business) {
    return <div className="flex h-dvh items-center justify-center text-ink-soft">Carregando…</div>;
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      <header className="flex flex-none items-center gap-3 border-b border-border bg-bg px-4 py-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-card font-serif font-bold"
          style={{ background: business.brandColor ?? "#1F5F52", color: "#fff" }}
        >
          {business.name?.[0] ?? "R"}
        </div>
        <div>
          <div className="text-sm font-semibold text-ink">{business.name}</div>
          <div className="flex items-center gap-1 text-xs text-positive">
            <span className="h-1.5 w-1.5 rounded-full bg-positive" /> Clara · Online agora
          </div>
        </div>
      </header>

      <main className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "visitor"
                ? "ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-accent px-4 py-3 text-sm text-white"
                : "max-w-[85%] rounded-2xl rounded-bl-sm bg-surface px-4 py-3 text-sm text-ink"
            }
          >
            <MessageContent text={m.content} />
          </div>
        ))}

        {sending && (
          <div className="flex max-w-[85%] items-center gap-1 rounded-2xl rounded-bl-sm bg-surface px-4 py-3">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft [animation-delay:-0.3s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft [animation-delay:-0.15s]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft" />
          </div>
        )}

        {showBooking && (
          <Card className="max-w-[90%]">
            <CardContent className="p-4">
              <div className="mb-2 text-xs uppercase tracking-wide text-ink-soft">
                Agendar {business.niche === "imobiliaria" ? "visita" : "test-drive"}
              </div>
              <div className="flex gap-2">
                <Input type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} className="flex-1" />
                <Input type="time" value={bookingTime} onChange={(e) => setBookingTime(e.target.value)} className="flex-1" />
              </div>
              <Input
                value={bookingName}
                onChange={(e) => setBookingName(e.target.value)}
                placeholder="Seu nome"
                className="mt-2"
              />
              <Input
                value={bookingPhone}
                onChange={(e) => setBookingPhone(maskBrPhone(e.target.value))}
                placeholder="(11) 99999-9999"
                type="tel"
                inputMode="numeric"
                className="mt-2"
              />
              <p className="mt-2 text-[0.7rem] text-ink-soft">
                Ao confirmar, você concorda em compartilhar esses dados com {business.name} para este atendimento.
              </p>
              <Button onClick={confirmBooking} className="mt-2 w-full">
                Confirmar
              </Button>
            </CardContent>
          </Card>
        )}
        <div ref={bottomRef} />
      </main>

      {bubbles.length > 0 && !showBooking && (
        <div className="flex flex-none flex-wrap gap-2 px-4 pb-2">
          {bubbles.map((bubble, i) => (
            <Button
              key={`${bubble.goto}-${i}`}
              variant="outline"
              size="sm"
              onClick={() => handleBubbleTap(bubble)}
              className="rounded-full bg-surface font-normal"
            >
              {bubble.label}
            </Button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend(input);
        }}
        className="flex flex-none items-center gap-2 border-t border-border bg-bg px-4 py-3"
      >
        <Input
          variant="pill"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escreva sua pergunta…"
          className="flex-1"
        />
        <Button type="submit" variant="round" size="icon" disabled={sending} className="rounded-full">
          ➤
        </Button>
      </form>
    </div>
  );
}
