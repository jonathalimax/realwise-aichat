"use client";

import { useEffect, useRef, useState } from "react";
import { maskBrPhone } from "@realwise/shared";
import { getBusiness, getChips, startConversation, sendMessage, bookAppointment, identifyVisitor } from "../lib/api";

interface Message {
  role: "visitor" | "assistant";
  content: string;
}

export function ChatScreen({ slug }: { slug: string }) {
  const [business, setBusiness] = useState<any>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chips, setChips] = useState<string[]>([]);
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
    getChips(business.id).then(setChips).catch(() => setChips([]));
  }, [business]);

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
      setMessages((prev) => [...prev, { role: "visitor", content: text }]);
      setInput("");
      await ensureConversation();
      setShowBooking(true);
      return;
    }

    setSending(true);
    setMessages((prev) => [...prev, { role: "visitor", content: text }]);
    setInput("");
    try {
      const convId = await ensureConversation();
      const result = await sendMessage(business.id, convId, text);
      setMessages((prev) => [...prev, { role: "assistant", content: result.message.content }]);
      if (result.escalated && result.whatsappUrl) {
        window.open(result.whatsappUrl, "_blank");
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Tive um problema para responder — tenta de novo em instantes." }]);
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
      { role: "assistant", content: `Agendado: ${serviceName} em ${startsAt.toLocaleDateString("pt-BR")} às ${bookingTime}. Vamos confirmar com você em breve.` },
    ]);
    setShowBooking(false);
  }

  if (!business) {
    return <div className="flex min-h-dvh items-center justify-center text-ink-soft">Carregando…</div>;
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
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
        {messages.length === 0 && (
          <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-surface px-4 py-3 text-sm text-ink">
            Oi! Eu sou a Clara, da {business.name}. Posso ajudar com {business.niche === "imobiliaria" ? "documentos, visitas e aluguel" : "estoque, financiamento e test-drive"}. O que você precisa?
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "visitor"
                ? "ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-accent px-4 py-3 text-sm text-white"
                : "max-w-[85%] rounded-2xl rounded-bl-sm bg-surface px-4 py-3 text-sm text-ink"
            }
          >
            {m.content}
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
          <div className="max-w-[90%] rounded-2xl border border-border bg-surface p-4 text-sm">
            <div className="mb-2 text-xs uppercase tracking-wide text-ink-soft">
              Agendar {business.niche === "imobiliaria" ? "visita" : "test-drive"}
            </div>
            <div className="flex gap-2">
              <input type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm" />
              <input type="time" value={bookingTime} onChange={(e) => setBookingTime(e.target.value)} className="flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm" />
            </div>
            <input
              value={bookingName}
              onChange={(e) => setBookingName(e.target.value)}
              placeholder="Seu nome"
              className="mt-2 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm"
            />
            <input
              value={bookingPhone}
              onChange={(e) => setBookingPhone(maskBrPhone(e.target.value))}
              placeholder="(11) 99999-9999"
              type="tel"
              inputMode="numeric"
              className="mt-2 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm"
            />
            <p className="mt-2 text-[0.7rem] text-ink-soft">
              Ao confirmar, você concorda em compartilhar esses dados com {business.name} para este atendimento.
            </p>
            <button onClick={confirmBooking} className="mt-2 w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">
              Confirmar
            </button>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      {chips.length > 0 && !showBooking && (
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {chips.map((chip) => (
            <button
              key={chip}
              onClick={() => handleSend(chip)}
              className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-ink-soft"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend(input);
        }}
        className="flex items-center gap-2 border-t border-border px-4 py-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escreva sua pergunta…"
          className="flex-1 rounded-full border border-border bg-bg px-4 py-2.5 text-sm text-ink outline-none"
        />
        <button
          type="submit"
          disabled={sending}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-white disabled:opacity-50"
        >
          ➤
        </button>
      </form>
    </div>
  );
}
