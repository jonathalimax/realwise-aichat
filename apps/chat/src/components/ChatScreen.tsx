"use client";

import { useEffect, useRef, useState } from "react";
import { maskBrPhone } from "@realwise/shared";
import {
  getBusiness,
  startConversation,
  getConversationHistory,
  streamMessage,
  bookAppointment,
  identifyVisitor,
  startFlow,
  advanceFlow,
  getAvailableSlots,
} from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent } from "./ui/card";

interface FlowBubble {
  label: string;
  goto: string;
  params?: Record<string, unknown>;
}

interface Listing {
  title: string;
  price?: string;
  description?: string;
  url?: string;
  imageUrl?: string;
}

interface Message {
  id: string;
  role: "visitor" | "assistant";
  content: string;
  listings?: Listing[];
  whatsappUrl?: string | null;
}

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;
const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp)(\?\S*)?$/i;
const VIDEO_EXTENSIONS = /\.(mp4|webm|mov)(\?\S*)?$/i;

// `white-space: pre-line` so the dense plain-text fallback (no structured listings available)
// still renders real paragraph breaks between distinct property/vehicle mentions instead of
// collapsing every "\n" into a single run-on block of prose.
function MessageContent({ text }: { text: string }) {
  const parts = text.split(URL_PATTERN);
  return (
    <span className="whitespace-pre-line">
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
    </span>
  );
}

// Real listing item (property/vehicle) rendered as a card — image with a sensible fallback when
// no real photo URL was captured, title, price, a short description snippet, and a tappable link
// to the real listing when one was genuinely found in the source documents.
// listing.url/imageUrl come from LLM-parsed JSON, not from code we control — only ever render
// them if they're a genuine http(s) URL, since a malformed/adversarial model response could
// otherwise produce a javascript: href or similar.
function safeHttpUrl(u?: string): string | undefined {
  if (!u) return undefined;
  try {
    const parsed = new URL(u);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function ListingCard({ listing }: { listing: Listing }) {
  const imageUrl = safeHttpUrl(listing.imageUrl);
  const url = safeHttpUrl(listing.url);
  return (
    <Card className="w-56 shrink-0 overflow-hidden">
      <div className="flex h-32 w-full items-center justify-center bg-border/40">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt={listing.title}
            className="h-32 w-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <span className="text-3xl" aria-hidden>
            🏠
          </span>
        )}
      </div>
      <CardContent className="p-3">
        <div className="line-clamp-2 text-sm font-semibold text-ink">{listing.title}</div>
        {listing.price && <div className="mt-1 text-sm font-semibold text-accent">{listing.price}</div>}
        {listing.description && <p className="mt-1 line-clamp-3 text-xs text-ink-soft">{listing.description}</p>}
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block rounded-full bg-accent px-3 py-1.5 text-center text-xs font-medium text-white"
          >
            Ver anúncio
          </a>
        )}
      </CardContent>
    </Card>
  );
}

function ListingCards({ listings }: { listings: Listing[] }) {
  return (
    <div className="-mx-1 flex w-full snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1">
      {listings.map((listing, i) => (
        <div key={`${listing.title}-${i}`} className="snap-start">
          <ListingCard listing={listing} />
        </div>
      ))}
    </div>
  );
}

// Real human handoff — a tappable card rather than auto-opening WhatsApp, so the visitor
// consciously chooses to leave the chat instead of being redirected without warning.
function WhatsappHandoffCard({ url }: { url: string }) {
  const safeUrl = safeHttpUrl(url);
  if (!safeUrl) return null;
  return (
    <Card className="w-64">
      <CardContent className="flex items-center gap-3 p-3">
        <span className="text-2xl" aria-hidden>
          💬
        </span>
        <div className="flex-1">
          <div className="text-sm font-semibold text-ink">Continuar no WhatsApp</div>
          <div className="text-xs text-ink-soft">Toque para falar com um atendente</div>
        </div>
      </CardContent>
      <a
        href={safeUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-b-card bg-accent px-3 py-2 text-center text-xs font-medium text-white"
      >
        Abrir WhatsApp
      </a>
    </Card>
  );
}

// Prefers the business's own logo; falls back to Clara's own photo (she's who's actually
// "talking" when a business hasn't set a logo yet) and, if even that fails to load, the
// initial-letter badge as a last resort so there's never a blank gap.
function BusinessAvatar({ name, logoUrl, brandColor }: { name: string; logoUrl?: string | null; brandColor?: string | null }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const [claraFailed, setClaraFailed] = useState(false);

  if (logoUrl && !logoFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={name}
        className="h-10 w-10 flex-none rounded-card object-cover"
        onError={() => setLogoFailed(true)}
      />
    );
  }
  if (!claraFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/clara-avatar.jpg"
        alt="Clara"
        className="h-10 w-10 flex-none rounded-card object-cover"
        onError={() => setClaraFailed(true)}
      />
    );
  }
  return (
    <div
      className="flex h-10 w-10 flex-none items-center justify-center rounded-card font-serif font-bold"
      style={{ background: brandColor ?? "#1F5F52", color: "#fff" }}
    >
      {name?.[0] ?? "R"}
    </div>
  );
}

let messageIdCounter = 0;
function nextMessageId() {
  messageIdCounter += 1;
  return `m${messageIdCounter}`;
}

export function ChatScreen({
  slug,
  resumeConversationId,
  resumeToken,
}: {
  slug: string;
  resumeConversationId?: string;
  resumeToken?: string;
}) {
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
  const [availableSlots, setAvailableSlots] = useState<{ start: string; end: string }[] | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ start: string; end: string } | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [flowRestored, setFlowRestored] = useState(false);
  const [thinkingStage, setThinkingStage] = useState<0 | 1>(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Holds the in-flight (or resolved) conversation-creation promise so a message sent before the
  // mount effect's startConversation() resolves awaits that SAME promise instead of racing a
  // second POST /conversations call — that race was creating a second conversation untouched by
  // flow/start, streaming the user's message into it, and then having the slower mount effect
  // overwrite conversationId/bubbles/messages state mid-stream.
  const conversationPromiseRef = useRef<Promise<string> | null>(null);
  // Stays true for the full lifetime of a send (from kickoff to final settle), unlike `sending`
  // which flips to false as soon as the first streamed delta arrives (for the typing indicator).
  // Used purely to prevent two concurrent sends on the same conversation.
  const isStreamingRef = useRef(false);

  useEffect(() => {
    getBusiness(slug).then(setBusiness).catch(() => setBusiness(null));
  }, [slug]);

  // Resolves the conversation eagerly (resume link id, or a fresh/matching one via the visitor
  // cookie) and loads its full message history BEFORE anything renders as an empty chat.
  useEffect(() => {
    if (!business) return;
    let cancelled = false;
    (async () => {
      let convId = resumeConversationId ?? null;
      if (!convId) {
        if (!conversationPromiseRef.current) {
          conversationPromiseRef.current = startConversation(business.id)
            .then((conversation) => conversation.id)
            .catch((error) => {
              conversationPromiseRef.current = null;
              throw error;
            });
        }
        convId = await conversationPromiseRef.current;
      } else {
        // Resume-link path: pin the ref to the already-known id so ensureConversation() below
        // never kicks off a second startConversation() call for this conversation.
        conversationPromiseRef.current = Promise.resolve(convId);
      }
      if (cancelled) return;
      setConversationId(convId);
      try {
        const history = await getConversationHistory(business.id, convId!, resumeConversationId ? resumeToken : undefined);
        if (cancelled) return;
        setMessages(history.messages.map((m: any) => ({ id: m.id, role: m.role, content: m.content })));
        if (history.flowSnapshot) {
          setBubbles(history.flowSnapshot.bubbles ?? []);
          setFlowRestored(true);
        }
      } catch {
        // History fetch failing must not block the chat — the flow/start effect below still
        // runs and starts a fresh conversation experience.
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [business, resumeConversationId, resumeToken]);

  // Only starts the scripted flow from the beginning for conversations with no stored
  // flowSnapshot — a resumed conversation already restored its bubbles above.
  useEffect(() => {
    if (!business || !conversationId || !historyLoaded || flowRestored) return;
    startFlow(business.id, conversationId)
      .then((result) => {
        setMessages((prev) => (prev.length === 0 ? [{ id: nextMessageId(), role: "assistant", content: result.message }] : prev));
        setBubbles(result.bubbles ?? []);
      })
      .catch(() => {});
  }, [business, conversationId, historyLoaded, flowRestored]);

  // requestAnimationFrame ensures this runs after layout settles (e.g. right after the sending
  // indicator or a new message mounts), and the visualViewport listener re-triggers the same
  // scroll once the mobile keyboard's viewport resize actually settles — otherwise the typing
  // indicator can end up rendered off-screen under the keyboard.
  useEffect(() => {
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    });
  }, [messages, showBooking, sending]);

  // Two-stage "thinking" label: starts as "Clara está pensando…" and, if the response takes
  // longer than ~5s, swaps to a message acknowledging the extra wait instead of leaving the
  // visitor staring at bare dots with no sense of progress.
  useEffect(() => {
    if (!sending) {
      setThinkingStage(0);
      return;
    }
    const timer = setTimeout(() => setThinkingStage(1), 5000);
    return () => clearTimeout(timer);
  }, [sending]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const onResize = () => {
      requestAnimationFrame(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      });
    };
    window.visualViewport.addEventListener("resize", onResize);
    return () => window.visualViewport?.removeEventListener("resize", onResize);
  }, []);

  async function ensureConversation() {
    if (conversationId) return conversationId;
    if (!business) return null;
    // Await the SAME promise the mount effect kicked off (or is about to kick off) instead of
    // racing a second startConversation() call while that effect hasn't resolved yet.
    if (!conversationPromiseRef.current) {
      conversationPromiseRef.current = startConversation(business.id)
        .then((conversation) => conversation.id)
        .catch((error) => {
          conversationPromiseRef.current = null;
          throw error;
        });
    }
    const id = await conversationPromiseRef.current;
    setConversationId(id);
    return id;
  }

  async function handleSend(text: string) {
    if (isStreamingRef.current) return;
    if (!text.trim() || !business) return;
    if (text.toLowerCase().includes("agendar")) {
      setMessages((prev) => [...prev, { id: nextMessageId(), role: "visitor", content: text }]);
      setInput("");
      setSending(true);
      try {
        await ensureConversation();
        setShowBooking(true);
        // null means no calendar connected — the booking card falls back to free-text date/time inputs.
        await getAvailableSlots(business.id).then(setAvailableSlots).catch(() => setAvailableSlots(null));
      } finally {
        setSending(false);
      }
      return;
    }

    setShowBooking(false);
    setSending(true);
    isStreamingRef.current = true;
    setMessages((prev) => [...prev, { id: nextMessageId(), role: "visitor", content: text }]);
    setInput("");

    const assistantId = nextMessageId();
    let assistantStarted = false;
    try {
      const convId = await ensureConversation();
      if (!convId) throw new Error("conversation_unavailable");
      const result = await streamMessage(business.id, convId, text, (delta) => {
        setSending(false);
        setMessages((prev) => {
          if (!assistantStarted) return [...prev, { id: assistantId, role: "assistant", content: delta }];
          return prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m));
        });
        assistantStarted = true;
      });
      if (result?.listings?.length) {
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, listings: result.listings } : m)));
      }
      if (result?.escalated && result?.whatsappUrl) {
        // Attach whatsappUrl to the message so WhatsappHandoffCard always renders a tappable card —
        // mobile browsers routinely block this best-effort popup, so the card can't be the only path.
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, whatsappUrl: result.whatsappUrl } : m)));
        window.open(result.whatsappUrl, "_blank");
      } else if (result?.flow?.bubbles) {
        setBubbles(result.flow.bubbles);
      }
    } catch {
      setMessages((prev) => [...prev, { id: nextMessageId(), role: "assistant", content: "Tive um problema para responder — tenta de novo em instantes." }]);
    } finally {
      setSending(false);
      isStreamingRef.current = false;
    }
  }

  async function handleBubbleTap(bubble: FlowBubble) {
    if (!business) return;
    if (isStreamingRef.current) return;

    setMessages((prev) => [...prev, { id: nextMessageId(), role: "visitor", content: bubble.label }]);
    setSending(true);
    isStreamingRef.current = true;
    try {
      const convId = await ensureConversation();
      if (!convId) throw new Error("conversation_unavailable");
      const result = await advanceFlow(business.id, convId, bubble.goto, bubble.params);
      setMessages((prev) => [
        ...prev,
        { id: nextMessageId(), role: "assistant", content: result.message, listings: result.listings, whatsappUrl: result.whatsappUrl },
      ]);
      setBubbles(result.bubbles ?? []);
    } catch {
      setMessages((prev) => [...prev, { id: nextMessageId(), role: "assistant", content: "Tive um problema para responder — tenta de novo em instantes." }]);
    } finally {
      setSending(false);
      isStreamingRef.current = false;
    }
  }

  async function confirmBooking() {
    if (!conversationId || !bookingName || !bookingPhone) return;
    const usingSlots = Array.isArray(availableSlots) && availableSlots.length > 0;
    if (usingSlots && !selectedSlot) return;
    if (!usingSlots && (!bookingDate || !bookingTime)) return;

    await identifyVisitor(slug, bookingName, bookingPhone);
    const startsAt = usingSlots ? new Date(selectedSlot!.start) : new Date(`${bookingDate}T${bookingTime}:00`);
    const endsAt = usingSlots ? new Date(selectedSlot!.end) : new Date(startsAt.getTime() + 30 * 60 * 1000);
    const serviceName = business.niche === "imobiliaria" ? "Visita ao imóvel" : "Test-drive";
    await bookAppointment(business.id, conversationId, serviceName, startsAt.toISOString(), endsAt.toISOString());
    setMessages((prev) => [
      ...prev,
      {
        id: nextMessageId(),
        role: "assistant",
        content: `Agendado: ${serviceName} em ${startsAt.toLocaleDateString("pt-BR")} às ${startsAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}. Vamos confirmar com você em breve.`,
      },
    ]);
    setShowBooking(false);
    setSelectedSlot(null);
  }

  if (!business) {
    return <div className="flex h-dvh items-center justify-center text-ink-soft">Carregando…</div>;
  }

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-bg">
      <header className="flex flex-none items-center gap-3 border-b border-border bg-bg px-4 py-3">
        <BusinessAvatar name={business.name} logoUrl={business.logoUrl} brandColor={business.brandColor} />
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
                ? "ml-auto max-w-[80%]"
                : m.listings?.length
                  ? "max-w-full"
                  : "max-w-[85%]"
            }
          >
            <div
              className={
                m.role === "visitor"
                  ? "rounded-2xl rounded-br-sm bg-accent px-4 py-3 text-sm text-white"
                  : "rounded-2xl rounded-bl-sm bg-surface px-4 py-3 text-sm text-ink"
              }
            >
              <MessageContent text={m.content} />
            </div>
            {m.listings && m.listings.length > 0 && (
              <div className="mt-2">
                <ListingCards listings={m.listings} />
              </div>
            )}
            {m.whatsappUrl && (
              <div className="mt-2">
                <WhatsappHandoffCard url={m.whatsappUrl} />
              </div>
            )}
          </div>
        ))}

        {sending && (
          <div
            role="status"
            aria-live="polite"
            className="flex max-w-[85%] items-center gap-2 rounded-2xl rounded-bl-sm bg-surface px-4 py-3"
          >
            <span className="text-sm text-ink-soft">
              {thinkingStage === 0 ? "Clara está pensando…" : "Clara está consultando as informações…"}
            </span>
            <span className="flex items-center gap-1" aria-hidden="true">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft" />
            </span>
          </div>
        )}

        {showBooking && (
          <Card className="max-w-[90%]">
            <CardContent className="p-4">
              <div className="mb-2 text-xs uppercase tracking-wide text-ink-soft">
                Agendar {business.niche === "imobiliaria" ? "visita" : "test-drive"}
              </div>
              {Array.isArray(availableSlots) && availableSlots.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {availableSlots.map((slot) => (
                    <Button
                      key={slot.start}
                      type="button"
                      size="sm"
                      variant={selectedSlot?.start === slot.start ? "default" : "outline"}
                      onClick={() => setSelectedSlot(slot)}
                    >
                      {new Date(slot.start).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}{" "}
                      {new Date(slot.start).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} className="flex-1" />
                  <Input type="time" value={bookingTime} onChange={(e) => setBookingTime(e.target.value)} className="flex-1" />
                </div>
              )}
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
