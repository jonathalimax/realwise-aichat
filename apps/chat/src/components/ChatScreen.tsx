"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { maskBrPhone, digitsOnly } from "@realwise/shared";
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
  pinListing,
} from "../lib/api";
import { isPushSupported, enablePush } from "../lib/push";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent } from "./ui/card";
import { ListingDetailOverlay, safeHttpUrl, type Listing } from "./ListingDetailOverlay";
import { MessageContent } from "./MessageContent";
import { SimulationCard, type SimulationData } from "./SimulationCard";

interface FlowBubble {
  label: string;
  goto: string;
  params?: Record<string, unknown>;
}

interface Message {
  id: string;
  role: "visitor" | "assistant" | "owner";
  content: string;
  listings?: Listing[];
  whatsappUrl?: string | null;
  // Financing-simulation breakdown (see simulator.service.ts) — rendered via SimulationCard
  // instead of the plain text bubble when present. `listings` above already carries this turn's
  // budget-matched inventory (same Message.listingIds rehydration path as any other card turn).
  simulationData?: SimulationData;
  // Set only for messages that originated from a server fetch (history load or poll tick) —
  // used to dedup against locally-created optimistic bubbles, which never get this field.
  serverId?: string;
}

// Real listing item (property/vehicle) rendered as a card — image with a sensible fallback when
// no real photo URL was captured, title, price, a short description snippet, and a tappable
// surface that opens the listing in-app (ListingDetailOverlay) instead of navigating away.
function ListingCard({
  listing,
  onOpen,
  onSelect,
}: {
  listing: Listing;
  onOpen: (listing: Listing) => void;
  onSelect?: (listing: Listing) => void;
}) {
  const imageUrl = safeHttpUrl(listing.imageUrl);
  const [imageFailed, setImageFailed] = useState(false);
  return (
    <Card className="flex h-[23rem] w-56 shrink-0 flex-col overflow-hidden">
      {/* flex-col + h-full here (rather than relying on the button below being flex-1) so the
          footer row below is pinned to the bottom via mt-auto regardless of how much vertical
          space the title/price/description block actually ends up using — every card in a
          carousel row lines its buttons up at the same height even when text length differs. */}
      <div className="flex h-full flex-col">
        <button
          type="button"
          onClick={() => onOpen(listing)}
          className="flex w-full flex-col overflow-hidden text-left active:scale-[0.98] transition-transform"
        >
          <div className="flex h-32 w-full shrink-0 items-center justify-center bg-border/40">
            {imageUrl && !imageFailed ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt={listing.title}
                className="h-32 w-full object-cover"
                onError={() => setImageFailed(true)}
              />
            ) : (
              <span className="text-3xl" aria-hidden>
                🏠
              </span>
            )}
          </div>
          <CardContent className="flex flex-col p-3">
            <div className="line-clamp-2 text-sm font-semibold text-ink">{listing.title}</div>
            {listing.price && <div className="mt-1 text-sm font-semibold text-accent">{listing.price}</div>}
            {listing.description && <p className="mt-1 line-clamp-3 text-xs text-ink-soft">{listing.description}</p>}
          </CardContent>
        </button>
        {/* Footer row lives outside the main clickable card button so "Selecionar" can sit next to
            "Ver anúncio" without either tap target swallowing the other — mt-auto pins it to the
            bottom of the h-full flex column above regardless of content length. "Ver anúncio" is
            a real button wired to the same onOpen the rest of the card uses, whether or not a
            photo is present — its destination never depends on image presence, only on whether we
            have anything worth opening (listing itself, always true here). */}
        <div className="mt-auto flex items-center gap-2 px-3 pb-3 pt-1">
          <button
            type="button"
            onClick={() => onOpen(listing)}
            className="tenant-accent-bg flex-1 rounded-full px-3 py-1.5 text-center text-xs font-medium text-white shadow-sm active:scale-[0.98] transition-transform"
          >
            Ver anúncio
          </button>
          {listing.id && onSelect && (
            <button
              type="button"
              onClick={() => onSelect(listing)}
              className="tenant-accent-border tenant-accent-text flex-1 rounded-full border bg-surface px-2 py-1.5 text-center text-xs font-medium active:scale-[0.98] transition-transform"
            >
              Selecionar
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

// Dot/count indicator for 2+ listings — tracks the active card via onScroll reading
// scrollLeft against a fixed card width (card is w-56 + gap-2) rather than measuring
// via ResizeObserver, to keep this simple.
const LISTING_CARD_STEP_PX = 224 + 8; // w-56 (14rem=224px) + gap-2 (8px)
const MAX_VISIBLE_DOTS = 8;
const BOOKING_EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function ListingCards({
  listings,
  onOpen,
  onSelect,
}: {
  listings: Listing[];
  onOpen: (listing: Listing) => void;
  onSelect?: (listing: Listing) => void;
}) {
  const [activeIndex, setActiveIndex] = useState(0);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const index = Math.round(e.currentTarget.scrollLeft / LISTING_CARD_STEP_PX);
    setActiveIndex(Math.max(0, Math.min(index, listings.length - 1)));
  }

  return (
    <div>
      <div
        onScroll={handleScroll}
        className="flex w-full scroll-smooth snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain px-1 pb-1"
      >
        {listings.map((listing, i) => (
          <div key={`${listing.title}-${i}`} className="snap-start">
            <ListingCard listing={listing} onOpen={onOpen} onSelect={onSelect} />
          </div>
        ))}
      </div>
      {listings.length > 1 && (
        <div className="mt-1 flex items-center justify-center gap-1">
          {listings.length <= MAX_VISIBLE_DOTS ? (
            listings.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full ${i === activeIndex ? "bg-accent" : "bg-border"}`}
              />
            ))
          ) : (
            <span className="text-xs text-ink-soft">
              {activeIndex + 1}/{listings.length}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Captures the visitor's WhatsApp number inline instead of handing off to an external wa.me
// link — the business calls the visitor back, so the chat stays mounted and no navigation
// away from the widget ever happens.
function WhatsappCaptureCard({
  onSubmit,
  businessName,
}: {
  onSubmit: (phone: string) => Promise<void>;
  businessName: string;
}) {
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const canSubmit = digitsOnly(phone).length === 10 || digitsOnly(phone).length === 11;

  async function handleSubmit() {
    if (!canSubmit) return;
    setStatus("saving");
    try {
      await onSubmit(phone);
      setStatus("done");
    } catch {
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <Card className="w-64">
        <CardContent className="p-3">
          <span className="text-2xl" aria-hidden>
            💬
          </span>
          <div className="mt-1 text-sm font-semibold text-ink">Agradecemos! Vamos te chamar no WhatsApp em breve.</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-64">
      <CardContent className="p-3">
        <span className="text-2xl" aria-hidden>
          💬
        </span>
        <div className="mt-1 text-sm font-semibold text-ink">Receber contato no WhatsApp</div>
        <div className="text-xs text-ink-soft">Deixe seu número que a gente te chama</div>
        <Input
          value={phone}
          onChange={(e) => setPhone(maskBrPhone(e.target.value))}
          placeholder="(11) 91234-5678"
          type="tel"
          inputMode="numeric"
          className="mt-2"
        />
        {status === "error" && (
          <p className="mt-1 text-xs text-negative">Não consegui salvar seu número — tenta de novo.</p>
        )}
        <p className="mt-2 text-[0.7rem] text-ink-soft">
          Ao enviar, você concorda em compartilhar seu telefone com {businessName} para este atendimento.
        </p>
        <Button
          type="button"
          disabled={!canSubmit || status === "saving"}
          onClick={handleSubmit}
          className="tenant-accent-bg mt-2 w-full"
        >
          Enviar
        </Button>
      </CardContent>
    </Card>
  );
}

// Niche -> persona name, mirroring apps/api/src/modules/chat/personas.ts's two cases. The API
// doesn't currently expose the persona name on the business/conversation response, so this is
// resolved locally from the niche the component already receives.
function getPersonaName(niche: string): string {
  return niche === "concessionaria" ? "Tom" : "Clara";
}

// Prefers the business's own logo; falls back to the persona's own photo (she/he's who's
// actually "talking" when a business hasn't set a logo yet) and, if even that fails to load, the
// initial-letter badge as a last resort so there's never a blank gap.
function BusinessAvatar({
  name,
  logoUrl,
  brandColor,
  personaName,
}: {
  name: string;
  logoUrl?: string | null;
  brandColor?: string | null;
  personaName: string;
}) {
  const [logoFailed, setLogoFailed] = useState(false);
  const [claraFailed, setClaraFailed] = useState(false);

  if (logoUrl && !logoFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt={name}
        className="h-10 w-10 flex-none rounded-card object-cover shadow-sm"
        onError={() => setLogoFailed(true)}
      />
    );
  }
  if (!claraFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/clara-avatar.jpg"
        alt={personaName}
        className="h-10 w-10 flex-none rounded-card object-cover shadow-sm"
        onError={() => setClaraFailed(true)}
      />
    );
  }
  // No logo, no persona photo available — falls back to the initial-letter badge, now sharing
  // the same --tenant-accent custom property (set on the page wrapper in ChatScreen below) as
  // every other brand-colored surface instead of its own separate inline style/fallback value.
  return (
    <div className="tenant-accent-bg flex h-10 w-10 flex-none items-center justify-center rounded-card font-serif font-bold text-white shadow-sm">
      {name?.[0] ?? "R"}
    </div>
  );
}

let messageIdCounter = 0;
function nextMessageId() {
  messageIdCounter += 1;
  return `m${messageIdCounter}`;
}

// The cookie the API also relies on to resume a conversation can fail cross-origin (chat on one
// origin/port, API on another) and is excluded for escalated conversations by the status filter
// getOrCreateConversation used to apply — localStorage is a same-origin, same-device fallback
// pointer so a refresh doesn't lose the conversation even when the cookie doesn't round-trip.
// Wrapped in try/catch everywhere since localStorage can throw in some embedded/private contexts.
function conversationStorageKey(slug: string) {
  return `rw_conv_${slug}`;
}

function readStoredConversation(slug: string): { id: string; resumeToken?: string } | null {
  try {
    const raw = localStorage.getItem(conversationStorageKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.id === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function storeConversation(slug: string, id: string, resumeToken?: string) {
  try {
    localStorage.setItem(conversationStorageKey(slug), JSON.stringify({ id, resumeToken }));
  } catch {
    // Ignore — localStorage can throw (private mode, embedded contexts); the cookie-based path
    // still works without this.
  }
}

function clearStoredConversation(slug: string) {
  try {
    localStorage.removeItem(conversationStorageKey(slug));
  } catch {
    // Ignore, same as above.
  }
}

// Shared by the polling effect and the manual-refresh handler. Dedupes server-fetched messages
// against what's already rendered — by `serverId` when the local copy has one (history-restored
// or already-merged-from-a-previous-poll messages), and by (role, trimmed content) for locally
// streamed/optimistic bubbles that never get a serverId, so a server echo of a just-streamed turn
// doesn't get appended as a visible duplicate.
function mergeServerMessages(prev: Message[], serverMessages: any[]): Message[] {
  const knownServerIds = new Set(prev.map((m) => m.serverId).filter(Boolean));
  const knownByContent = new Set(prev.map((m) => `${m.role}:${m.content.trim()}`));
  const newOnes = (serverMessages ?? [])
    .filter((m: any) => !knownServerIds.has(m.id) && !knownByContent.has(`${m.role}:${String(m.content ?? "").trim()}`))
    .map((m: any) => ({ id: m.id, serverId: m.id, role: m.role, content: m.content, listings: m.listings }));
  if (newOnes.length === 0) return prev;
  return [...prev, ...newOnes];
}

type Slot = { start: string; end: string };

// Groups the backend's flat, ascending-order slot list by calendar day so the picker can show
// one tappable day row (with a count) followed by that day's individual time chips, instead of
// one giant flat wrap of buttons once more than a handful of slots come back.
function groupSlotsByDay(slots: Slot[]): { dayKey: string; label: string; weekday: string; slots: Slot[] }[] {
  const groups = new Map<string, Slot[]>();
  for (const slot of slots) {
    const dayKey = new Date(slot.start).toLocaleDateString("pt-BR");
    const existing = groups.get(dayKey);
    if (existing) existing.push(slot);
    else groups.set(dayKey, [slot]);
  }
  return Array.from(groups.entries()).map(([dayKey, daySlots]) => {
    const sample = new Date(daySlots[0].start);
    return {
      dayKey,
      label: sample.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
      weekday: sample.toLocaleDateString("pt-BR", { weekday: "short" }),
      slots: daySlots,
    };
  });
}

// Day/time grouped slot picker — replaces the old flat wrap of every slot as its own button,
// which became unreadable once a connected calendar returned more than a few options.
function SlotPicker({
  slots,
  selected,
  onSelect,
}: {
  slots: Slot[];
  selected: Slot | null;
  onSelect: (s: Slot) => void;
}) {
  const days = groupSlotsByDay(slots);
  const [activeDayKey, setActiveDayKey] = useState(days[0]?.dayKey ?? "");

  useEffect(() => {
    setActiveDayKey(groupSlotsByDay(slots)[0]?.dayKey ?? "");
  }, [slots]);

  const activeDay = days.find((d) => d.dayKey === activeDayKey) ?? days[0];

  return (
    <div>
      <div className="flex w-full scroll-smooth snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain px-1 pb-1">
        {days.map((day) => {
          const isActive = day.dayKey === activeDay?.dayKey;
          return (
            <button
              key={day.dayKey}
              type="button"
              onClick={() => setActiveDayKey(day.dayKey)}
              className={
                isActive
                  ? "tenant-accent-bg shrink-0 snap-start rounded-card border px-3 py-2 text-center text-white active:scale-[0.98] transition-transform"
                  : "tenant-accent-border tenant-accent-text shrink-0 snap-start rounded-card border bg-surface px-3 py-2 text-center active:scale-[0.98] transition-transform"
              }
            >
              <div className="text-[0.65rem] uppercase text-ink-soft">{day.weekday}</div>
              <div className="text-sm font-semibold">{day.label}</div>
              <div className="text-[0.65rem]">{day.slots.length} horários</div>
            </button>
          );
        })}
      </div>
      {activeDay && (
        <div className="mt-2 flex flex-wrap gap-2">
          {activeDay.slots.map((slot) => {
            const isSelected = selected?.start === slot.start;
            return (
              <button
                key={slot.start}
                type="button"
                onClick={() => onSelect(slot)}
                className={
                  isSelected
                    ? "tenant-accent-bg rounded-card border px-3 py-2 text-center text-white active:scale-[0.98] transition-transform"
                    : "tenant-accent-border tenant-accent-text rounded-card border bg-surface px-3 py-2 text-center active:scale-[0.98] transition-transform"
                }
              >
                {new Date(slot.start).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
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
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showBooking, setShowBooking] = useState(false);
  const [bookingDate, setBookingDate] = useState("");
  const [bookingTime, setBookingTime] = useState("");
  const [bookingName, setBookingName] = useState("");
  const [bookingPhone, setBookingPhone] = useState("");
  const [bookingEmail, setBookingEmail] = useState("");
  const [leadCaptured, setLeadCaptured] = useState(false);
  const [bookingSubmitting, setBookingSubmitting] = useState(false);
  const [availableSlots, setAvailableSlots] = useState<{ start: string; end: string }[] | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ start: string; end: string } | null>(null);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [flowRestored, setFlowRestored] = useState(false);
  const [thinkingStage, setThinkingStage] = useState<0 | 1>(0);
  const [activeListing, setActiveListing] = useState<Listing | null>(null);
  const [conversationStatus, setConversationStatus] = useState<string | null>(null);
  const [pollCapped, setPollCapped] = useState(false);
  const [pushPrompt, setPushPrompt] = useState<"hidden" | "asking" | "done">("hidden");
  const [businessNotFound, setBusinessNotFound] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Holds the in-flight (or resolved) conversation-creation promise so a message sent before the
  // mount effect's startConversation() resolves awaits that SAME promise instead of racing a
  // second POST /conversations call — that race was creating a second conversation untouched by
  // flow/start, streaming the user's message into it, and then having the slower mount effect
  // overwrite conversationId/bubbles/messages state mid-stream.
  const conversationPromiseRef = useRef<Promise<string> | null>(null);
  // Stays true for the full lifetime of a send (from kickoff to final settle), unlike `sending`
  // which flips to false as soon as the first streamed delta arrives (for the typing indicator).
  // Used purely to prevent two concurrent sends on the same conversation — the ref (not the
  // mirrored `busy` state below) is the real concurrency guard, so it's read/written synchronously
  // without waiting on a render.
  const isStreamingRef = useRef(false);
  // Mirrors isStreamingRef into state purely so the submit button can be disabled for the full
  // duration of a send — `sending` alone isn't enough since it flips false on the first delta.
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getBusiness(slug)
      .then(setBusiness)
      .catch(() => {
        setBusiness(null);
        setBusinessNotFound(true);
      });
  }, [slug]);

  // Resolves the conversation eagerly (resume link id, or a fresh/matching one via the visitor
  // cookie) and loads its full message history BEFORE anything renders as an empty chat.
  useEffect(() => {
    if (!business) return;
    let cancelled = false;
    (async () => {
      // Resolution priority: an explicit resume link (?c=&t=) > a previously-stored localStorage
      // pointer for this business (self-healing fallback for the cookie, which can fail
      // cross-origin or get excluded once a conversation escalates) > starting a brand-new one.
      let convId = resumeConversationId ?? null;
      let effectiveResumeToken = resumeConversationId ? resumeToken : undefined;
      const stored = !convId ? readStoredConversation(slug) : null;
      if (!convId && stored) {
        convId = stored.id;
        effectiveResumeToken = stored.resumeToken;
      }

      if (!convId) {
        if (!conversationPromiseRef.current) {
          conversationPromiseRef.current = startConversation(business.id)
            .then((conversation) => {
              storeConversation(slug, conversation.id, conversation.resumeToken);
              return conversation.id;
            })
            .catch((error) => {
              conversationPromiseRef.current = null;
              throw error;
            });
        }
        convId = await conversationPromiseRef.current;
      } else {
        // Resume-link/localStorage path: pin the ref to the already-known id so
        // ensureConversation() below never kicks off a second startConversation() call.
        conversationPromiseRef.current = Promise.resolve(convId);
      }
      if (cancelled) return;
      setConversationId(convId);
      try {
        const history = await getConversationHistory(business.id, convId!, effectiveResumeToken);
        if (cancelled) return;
        const restoredMessages: Message[] = history.messages.map((m: any) => ({
          id: m.id,
          serverId: m.id,
          role: m.role,
          content: m.content,
          listings: m.listings,
          simulationData: m.simulationData,
        }));
        // Older conversations that predate server-side message persistence for the scripted
        // bubble flow (or any conversation that only ever got this far via taps) have an empty
        // `messages` history even though a real flowSnapshot exists — repaint that snapshot's
        // message/listings as the trailing assistant turn so refresh still shows something real
        // instead of a blank thread.
        if (restoredMessages.length === 0 && history.flowSnapshot?.message) {
          restoredMessages.push({
            id: nextMessageId(),
            role: "assistant",
            content: history.flowSnapshot.message,
            listings: history.flowSnapshot.listings,
            whatsappUrl: history.flowSnapshot.whatsappUrl,
          });
        }
        setMessages(restoredMessages);
        setConversationStatus(history.conversation?.status ?? null);
        setLeadCaptured(Boolean(history.conversation?.hasLead));
        if (history.flowSnapshot) {
          // Never repaint stale bubbles on refresh after escalation — a human took over, so the
          // old scripted-flow bubbles no longer apply.
          if (history.conversation?.status !== "escalated") {
            setBubbles(history.flowSnapshot.bubbles ?? []);
          }
          setSuggestions([]);
          setFlowRestored(true);
        }
        // Keep the localStorage pointer fresh/stored only once the conversation is confirmed to
        // still be resolvable — never store an id that just failed to resolve below.
        storeConversation(slug, convId!, history.conversation?.resumeToken ?? effectiveResumeToken);
      } catch (error) {
        // A stale/foreign id (403/404) must not get retried forever — clear the bad pointer so
        // the next load starts a genuinely fresh conversation instead of repeating the same
        // failure. Any other error (network blip, timeout) leaves the pointer alone.
        const status = (error as { status?: number })?.status;
        if (stored && (status === 403 || status === 404)) {
          clearStoredConversation(slug);
        }
        // History fetch failing must not block the chat — the flow/start effect below still
        // runs and starts a fresh conversation experience.
      } finally {
        if (!cancelled) setHistoryLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [business, resumeConversationId, resumeToken, slug]);

  // Only starts the scripted flow from the beginning for conversations with no stored
  // flowSnapshot — a resumed conversation already restored its bubbles above.
  useEffect(() => {
    if (!business || !conversationId || !historyLoaded || flowRestored) return;
    startFlow(business.id, conversationId)
      .then((result) => {
        setMessages((prev) => (prev.length === 0 ? [{ id: nextMessageId(), role: "assistant", content: result.message }] : prev));
        setBubbles(result.bubbles ?? []);
        setSuggestions([]);
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

  // Near-live delivery of owner replies: polls history only while the conversation is escalated
  // (that's the only window where a human might actually be typing), the tab is visible, and no
  // send/stream is currently in flight. Caps continuous foreground polling at ~15min to avoid
  // hammering an abandoned-but-open tab forever; past the cap, a manual "Atualizar" affordance
  // replaces the interval.
  useEffect(() => {
    if (!business || !conversationId || conversationStatus !== "escalated" || pollCapped) return;

    const POLL_INTERVAL_MS = 8000;
    const POLL_CAP_MS = 15 * 60 * 1000;
    const startedAt = Date.now();
    let intervalId: ReturnType<typeof setInterval> | null = null;

    async function poll() {
      if (document.visibilityState !== "visible") return;
      if (isStreamingRef.current) return;
      if (Date.now() - startedAt >= POLL_CAP_MS) {
        setPollCapped(true);
        return;
      }
      try {
        const history = await getConversationHistory(business.id, conversationId!, resumeConversationId ? resumeToken : undefined);
        if (history.conversation?.status) setConversationStatus(history.conversation.status);
        setMessages((prev) => mergeServerMessages(prev, history.messages ?? []));
      } catch {
        // A single failed poll tick is silently ignored — the next tick retries.
      }
    }

    function start() {
      if (intervalId) return;
      intervalId = setInterval(poll, POLL_INTERVAL_MS);
    }
    function stop() {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    }

    if (document.visibilityState === "visible") start();

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        poll();
        start();
      } else {
        stop();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [business, conversationId, conversationStatus, pollCapped, resumeConversationId, resumeToken]);

  // Conversational opt-in: once a conversation escalates to human handoff, ask the visitor (in
  // Clara's voice, in a normal chat bubble) whether they want a notification if they leave —
  // instead of a cold browser permission popup with no context. Asked at most once per
  // conversation (localStorage flag), and only when the browser hasn't already decided.
  useEffect(() => {
    if (!business || !conversationId) return;
    if (conversationStatus !== "escalated") return;
    if (!isPushSupported()) return;
    if (typeof Notification === "undefined" || Notification.permission !== "default") return;
    if (pushPrompt !== "hidden") return;

    const askedKey = `rw_push_asked_${conversationId}`;
    if (localStorage.getItem(askedKey)) return;

    setMessages((prev) => [
      ...prev,
      {
        id: nextMessageId(),
        role: "assistant",
        content: "Enquanto você espera, quer que eu te avise por notificação quando a resposta chegar, mesmo que você saia dessa tela?",
      },
    ]);
    setPushPrompt("asking");
  }, [business, conversationId, conversationStatus, pushPrompt]);

  // Returning visitor whose browser already granted permission (e.g. a previous conversation on
  // this same origin) but who has no active subscription for THIS conversation yet — subscribe
  // silently, no prompt needed since permission is already settled.
  useEffect(() => {
    if (!business || !conversationId) return;
    if (!isPushSupported()) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    enablePush(business.id, conversationId).catch(() => {});
  }, [business, conversationId]);

  async function handlePushChoice(accepted: boolean) {
    if (!business || !conversationId) return;
    const askedKey = `rw_push_asked_${conversationId}`;
    localStorage.setItem(askedKey, "1");

    if (accepted) {
      const result = await enablePush(business.id, conversationId);
      setMessages((prev) => [
        ...prev,
        {
          id: nextMessageId(),
          role: "assistant",
          content:
            result === "granted"
              ? "Perfeito, vou te avisar por aqui assim que tivermos uma resposta!"
              : "Não consegui ativar a notificação agora, mas pode continuar acompanhando por aqui.",
        },
      ]);
    } else {
      setMessages((prev) => [
        ...prev,
        { id: nextMessageId(), role: "assistant", content: "Sem problema, fico por aqui aguardando você." },
      ]);
    }
    setPushPrompt("done");
  }

  async function handleManualRefresh() {
    if (!business || !conversationId) return;
    try {
      const history = await getConversationHistory(business.id, conversationId, resumeConversationId ? resumeToken : undefined);
      if (history.conversation?.status) setConversationStatus(history.conversation.status);
      setMessages((prev) => mergeServerMessages(prev, history.messages ?? []));
    } catch {
      // Manual refresh failing silently is fine — the button stays available to retry.
    }
  }

  async function ensureConversation() {
    if (conversationId) return conversationId;
    if (!business) return null;
    // Await the SAME promise the mount effect kicked off (or is about to kick off) instead of
    // racing a second startConversation() call while that effect hasn't resolved yet.
    if (!conversationPromiseRef.current) {
      conversationPromiseRef.current = startConversation(business.id)
        .then((conversation) => {
          storeConversation(slug, conversation.id, conversation.resumeToken);
          return conversation.id;
        })
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
    // Guard on the ref (synchronous, no render lag) so a mid-stream double-send is rejected
    // without a race — the typed text is deliberately NOT cleared here so a rejected send doesn't
    // silently lose what the visitor typed.
    if (isStreamingRef.current) return;
    if (!text.trim() || !business) return;
    setSuggestions([]);
    setBubbles([]);
    if (text.toLowerCase().includes("agendar")) {
      setMessages((prev) => [...prev, { id: nextMessageId(), role: "visitor", content: text }]);
      setInput("");
      setSending(true);
      setBusy(true);
      isStreamingRef.current = true;
      try {
        await ensureConversation();
        setShowBooking(true);
        setAvailableSlots(null);
        setSelectedSlot(null);
        // null means no calendar connected — the booking card falls back to free-text date/time inputs.
        await getAvailableSlots(business.id).then(setAvailableSlots).catch(() => setAvailableSlots(null));
      } finally {
        setSending(false);
        setBusy(false);
        isStreamingRef.current = false;
      }
      return;
    }

    setShowBooking(false);
    setSending(true);
    setBusy(true);
    isStreamingRef.current = true;
    setMessages((prev) => [...prev, { id: nextMessageId(), role: "visitor", content: text }]);
    setInput("");

    const assistantId = nextMessageId();
    // Accumulates streamed text outside the setState updater purely so the zero-delta fallback
    // below can check "did anything actually stream" without relying on a mutated flag read from
    // inside a setState updater (which can double-invoke under React 18 strict mode).
    let streamed = "";
    try {
      const convId = await ensureConversation();
      if (!convId) throw new Error("conversation_unavailable");
      const result = await streamMessage(business.id, convId, text, (delta) => {
        setSending(false);
        streamed += delta;
        setMessages((prev) =>
          prev.some((m) => m.id === assistantId)
            ? prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m))
            : [...prev, { id: assistantId, role: "assistant", content: delta }],
        );
      });

      // The backend can resolve a turn (e.g. abstention/escalation canned copy) without ever
      // emitting a `delta` event — nothing got rendered above in that case. Build the bubble from
      // the final `done` payload instead of leaving the visitor staring at silence until a
      // refresh re-fetches persisted history. Done BEFORE the listings/whatsappUrl attachment
      // below so those attach to a bubble that now actually exists.
      if (!streamed) {
        const finalText =
          result?.message?.content ?? result?.message ?? result?.content ?? result?.text ?? undefined;
        setMessages((prev) =>
          prev.some((m) => m.id === assistantId)
            ? prev
            : [
                ...prev,
                {
                  id: assistantId,
                  role: "assistant",
                  content:
                    typeof finalText === "string" && finalText.trim().length > 0
                      ? finalText
                      : "Tive um problema para responder — tenta de novo em instantes.",
                },
              ],
        );
      }

      if (result?.listings?.length) {
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, listings: result.listings } : m)));
      }
      if (result?.message?.simulationData) {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, simulationData: result.message.simulationData } : m)),
        );
      }
      setSuggestions(result?.suggestions ?? []);
      if (result?.escalated) {
        setConversationStatus("escalated");
      }
      if (result?.escalated && result?.whatsappUrl) {
        // Attach whatsappUrl to the message so WhatsappCaptureCard renders inline — the visitor
        // leaves their number here instead of navigating out to wa.me; the business calls back.
        setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, whatsappUrl: result.whatsappUrl } : m)));
      }
      if (!result?.escalated && result?.flow?.bubbles?.length) {
        setBubbles(result.flow.bubbles);
        setSuggestions([]);
      } else if (!result?.escalated && result?.conversationalMode) {
        // This was an LLM/conversational turn, not a flow-bubble turn — clear any bubbles left
        // over from an earlier scripted turn so the suggestions renderer below (gated on
        // `bubbles.length === 0`) isn't permanently blocked once conversational mode suppresses
        // bubbles after first contact. Gated on conversationalMode so flag-off tenants keep the
        // pre-existing behavior of never clearing bubbles on a non-flow LLM turn.
        setBubbles([]);
      }
    } catch {
      setMessages((prev) => [...prev, { id: nextMessageId(), role: "assistant", content: "Tive um problema para responder — tenta de novo em instantes." }]);
    } finally {
      setSending(false);
      setBusy(false);
      isStreamingRef.current = false;
    }
  }

  // "Selecionar" — pins the listing server-side, then sends a natural message
  // through the existing send flow so the visitor sees a conversational transition and gets an
  // immediate acknowledging response grounded on that specific listing.
  async function handleSelectListing(listing: Listing) {
    if (!business || !listing.id) return;
    try {
      const convId = await ensureConversation();
      if (!convId) return;
      await pinListing(business.id, convId, listing.id);
    } catch {
      // Pin failing silently still lets the visitor send the follow-up text below — worst case
      // it resolves via the existing message-history lookback instead of the explicit pin.
    }
    handleSend(`Quero saber mais sobre ${listing.title}`);
  }

  async function handleBubbleTap(bubble: FlowBubble) {
    if (!business) return;
    if (isStreamingRef.current) return;

    setMessages((prev) => [...prev, { id: nextMessageId(), role: "visitor", content: bubble.label }]);
    setSending(true);
    setBusy(true);
    setSuggestions([]);
    isStreamingRef.current = true;
    try {
      const convId = await ensureConversation();
      if (!convId) throw new Error("conversation_unavailable");
      const result = await advanceFlow(business.id, convId, bubble.goto, bubble.params, bubble.label);
      setMessages((prev) => [
        ...prev,
        { id: nextMessageId(), role: "assistant", content: result.message, listings: result.listings, whatsappUrl: result.whatsappUrl },
      ]);
      setBubbles(result.bubbles ?? []);
    } catch {
      setMessages((prev) => [...prev, { id: nextMessageId(), role: "assistant", content: "Tive um problema para responder — tenta de novo em instantes." }]);
    } finally {
      setSending(false);
      setBusy(false);
      isStreamingRef.current = false;
    }
  }

  async function handleCaptureWhatsapp(phone: string) {
    await identifyVisitor(slug, null, phone);
    setLeadCaptured(true);
  }

  async function confirmBooking() {
    if (!conversationId || !bookingName || !bookingPhone || !bookingEmail) return;
    const usingSlots = Array.isArray(availableSlots) && availableSlots.length > 0;
    if (usingSlots && !selectedSlot) return;
    if (!usingSlots && (!bookingDate || !bookingTime)) return;
    const phoneDigits = digitsOnly(bookingPhone).length;
    if (phoneDigits !== 10 && phoneDigits !== 11) return;
    if (!BOOKING_EMAIL_PATTERN.test(bookingEmail.trim())) return;

    const startsAt = usingSlots ? new Date(selectedSlot!.start) : new Date(`${bookingDate}T${bookingTime}:00`);
    const endsAt = usingSlots ? new Date(selectedSlot!.end) : new Date(startsAt.getTime() + 30 * 60 * 1000);
    const serviceName = business.niche === "imobiliaria" ? "Visita ao imóvel" : "Test-drive";
    setBookingSubmitting(true);
    // identifyVisitor 400s on a malformed email/phone — that's a client input problem, not a
    // slot capacity race, so it must not clear the selected slot or trigger a slot re-fetch
    // (which would otherwise hide the real cause behind the generic "ocupado" message). Only a
    // failure from bookAppointment itself (after identify already succeeded) is a real race.
    try {
      await identifyVisitor(slug, bookingName, bookingPhone, bookingEmail);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      setMessages((prev) => [
        ...prev,
        {
          id: nextMessageId(),
          role: "assistant",
          content:
            typeof status === "number" && status >= 400 && status < 500
              ? "Verifica seu e-mail e telefone e tenta de novo."
              : "Não consegui confirmar seus dados — tenta de novo.",
        },
      ]);
      setBookingSubmitting(false);
      return;
    }
    try {
      await bookAppointment(business.id, conversationId, serviceName, startsAt.toISOString(), endsAt.toISOString());
      setLeadCaptured(true);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: nextMessageId(),
          role: "assistant",
          content: "Não consegui confirmar esse horário — ele pode ter sido ocupado. Escolhe outro?",
        },
      ]);
      getAvailableSlots(business.id).then(setAvailableSlots).catch(() => setAvailableSlots(null));
      setSelectedSlot(null);
      setBookingSubmitting(false);
      return;
    }
    setBookingSubmitting(false);
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
    setBookingEmail("");
  }

  if (!business) {
    if (businessNotFound) {
      return (
        <div className="flex h-dvh items-center justify-center px-6 text-center text-ink-soft">
          Este link não existe ou não está mais disponível.
        </div>
      );
    }
    return <div className="flex h-dvh items-center justify-center text-ink-soft">Carregando…</div>;
  }

  return (
    // --tenant-accent is set here (inline, since it's a dynamic per-tenant value) from
    // business.brandColor, falling back to the design-system accent green defined in
    // globals.css when the tenant hasn't set one. Every brand-colored surface below (avatar
    // badge, visitor bubble tint, send/primary buttons) reads this same custom property instead
    // of each carrying its own separate inline style.
    <div
      className="flex h-dvh flex-col overflow-hidden bg-bg"
      style={business.brandColor ? ({ "--tenant-accent": business.brandColor } as React.CSSProperties) : undefined}
    >
      <header className="flex flex-none items-center gap-3 border-b border-border bg-bg/80 px-4 py-3 backdrop-blur-md">
        <BusinessAvatar
          name={business.name}
          logoUrl={business.logoUrl}
          brandColor={business.brandColor}
          personaName={getPersonaName(business.niche)}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-ink">{business.name}</div>
          <div className="flex items-center gap-1 text-xs text-positive">
            <span className="h-1.5 w-1.5 rounded-full bg-positive" /> {getPersonaName(business.niche)} · Online agora
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto overflow-x-hidden px-4 py-4">
        {messages.map((m, i) => {
          const isFirstInGroup = i === 0 || messages[i - 1].role !== m.role;
          return (
          <div
            key={m.id}
            className={
              (isFirstInGroup ? "mt-3" : "mt-1") +
              " " +
              (m.role === "visitor"
                ? "ml-auto max-w-[80%]"
                : m.listings?.length || m.simulationData
                  ? "max-w-full"
                  : "max-w-[85%]")
            }
          >
            {isFirstInGroup && m.role === "owner" && (
              <div className="mb-1 text-xs font-semibold text-accent">{business.name}</div>
            )}
            {isFirstInGroup && m.role === "assistant" && (
              <div className="mb-1 text-xs font-semibold text-ink-soft">{getPersonaName(business.niche)}</div>
            )}
            <div
              className={
                m.role === "visitor"
                  ? "tenant-bubble rounded-3xl rounded-br-lg px-4 py-3 text-sm text-ink break-words"
                  : m.role === "owner"
                    ? "rounded-3xl rounded-bl-lg border border-accent/30 bg-accent-soft px-4 py-3 text-sm text-ink break-words shadow-sm"
                    : "ai-bubble rounded-3xl rounded-bl-lg px-4 py-3 text-sm text-ink break-words shadow-sm"
              }
            >
              <MessageContent text={m.content} />
            </div>
            {m.simulationData ? (
              <SimulationCard
                data={m.simulationData}
                listings={m.listings}
                niche={business.niche}
                onOpenListing={setActiveListing}
                onSelectListing={handleSelectListing}
              />
            ) : (
              m.listings &&
              m.listings.length > 0 && (
                <div className="mt-2">
                  <ListingCards listings={m.listings} onOpen={setActiveListing} onSelect={handleSelectListing} />
                </div>
              )
            )}
            {m.whatsappUrl && !leadCaptured && (
              <div className="mt-2">
                <WhatsappCaptureCard onSubmit={handleCaptureWhatsapp} businessName={business.name} />
              </div>
            )}
          </div>
          );
        })}

        {sending && (
          <div
            role="status"
            aria-live="polite"
            className="mt-3 flex max-w-[85%] items-center gap-2 rounded-3xl rounded-bl-lg bg-surface px-4 py-3 shadow-sm"
          >
            <span className="text-sm text-ink-soft">
              {thinkingStage === 0
                ? `${getPersonaName(business.niche)} está pensando`
                : `${getPersonaName(business.niche)} está consultando as informações`}
            </span>
            <span className="flex items-center gap-1" aria-hidden="true">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-soft" />
            </span>
          </div>
        )}

        {showBooking && (
          <Card className="mt-3 max-w-[90%]">
            <CardContent className="p-4">
              <div className="mb-2 text-xs uppercase tracking-wide text-ink-soft">
                Agendar {business.niche === "imobiliaria" ? "visita" : "test-drive"}
              </div>
              {Array.isArray(availableSlots) && availableSlots.length > 0 ? (
                <SlotPicker slots={availableSlots} selected={selectedSlot} onSelect={setSelectedSlot} />
              ) : Array.isArray(availableSlots) ? (
                <div>
                  <p className="text-sm text-ink-soft">
                    Não tenho horários abertos nos próximos 14 dias — me conta qual dia funciona pra você?
                  </p>
                  <Button type="button" variant="outline" className="mt-2 w-full" onClick={() => setShowBooking(false)}>
                    Fechar
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <Input type="date" value={bookingDate} onChange={(e) => setBookingDate(e.target.value)} className="flex-1" />
                  <Input type="time" value={bookingTime} onChange={(e) => setBookingTime(e.target.value)} className="flex-1" />
                </div>
              )}
              {!(Array.isArray(availableSlots) && availableSlots.length === 0) && (
                <>
                  <Input
                    value={bookingName}
                    onChange={(e) => setBookingName(e.target.value)}
                    placeholder="Seu nome"
                    className="mt-2"
                  />
                  <Input
                    value={bookingEmail}
                    onChange={(e) => setBookingEmail(e.target.value)}
                    placeholder="seu@email.com"
                    type="email"
                    inputMode="email"
                    className="mt-2"
                  />
                  {bookingEmail.length > 0 && !BOOKING_EMAIL_PATTERN.test(bookingEmail.trim()) && (
                    <p className="mt-1 text-xs text-negative">Digite um e-mail válido.</p>
                  )}
                  <Input
                    value={bookingPhone}
                    onChange={(e) => setBookingPhone(maskBrPhone(e.target.value))}
                    placeholder="(11) 99999-9999"
                    type="tel"
                    inputMode="numeric"
                    className="mt-2"
                  />
                  <p className="mt-2 text-[0.7rem] text-ink-soft">
                    Ao confirmar, você concorda em compartilhar seu nome, e-mail e telefone com {business.name} para este
                    atendimento.
                  </p>
                  <Button
                    onClick={confirmBooking}
                    disabled={bookingSubmitting || (bookingEmail.length > 0 && !BOOKING_EMAIL_PATTERN.test(bookingEmail.trim()))}
                    className="mt-2 w-full"
                  >
                    {bookingSubmitting ? "Confirmando…" : "Confirmar"}
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}
        {pollCapped && conversationStatus === "escalated" && (
          <div className="mt-3 flex justify-center">
            <Button type="button" variant="outline" size="sm" onClick={handleManualRefresh}>
              Atualizar
            </Button>
          </div>
        )}
        {pushPrompt === "asking" && (
          <div className="mt-3 flex justify-center gap-2">
            <Button type="button" size="sm" onClick={() => handlePushChoice(true)}>
              Sim
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => handlePushChoice(false)}>
              Não
            </Button>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      {bubbles.length > 0 && !showBooking && (
        <div className="flex flex-none flex-wrap gap-2 px-4 pb-2">
          {bubbles.slice(0, 5).map((bubble, i) => (
            <Button
              key={`${bubble.goto}-${i}`}
              variant="outline"
              size="sm"
              onClick={() => handleBubbleTap(bubble)}
              className="h-auto min-h-11 rounded-full bg-surface py-2 font-normal shadow-sm"
            >
              {bubble.label}
            </Button>
          ))}
        </div>
      )}

      {bubbles.length === 0 && suggestions.length > 0 && !showBooking && !sending && (
        <div className="flex flex-none flex-wrap gap-2 px-4 pb-2">
          {suggestions.slice(0, 5).map((label, i) => (
            <Button
              key={`suggestion-${i}`}
              variant="outline"
              size="sm"
              onClick={() => {
                setSuggestions([]);
                handleSend(label);
              }}
              className="h-auto min-h-11 rounded-full bg-surface py-2 font-normal shadow-sm"
            >
              {label}
            </Button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend(input);
        }}
        className="flex flex-none items-center gap-2 bg-bg/80 px-4 py-3 shadow-[0_-10px_20px_-16px_rgba(20,24,21,0.18)] backdrop-blur-md"
      >
        <Input
          variant="pill"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escreva sua mensagem…"
          className="flex-1"
        />
        <Button type="submit" variant="round" size="icon" disabled={sending || busy} className="rounded-full">
          ➤
        </Button>
      </form>

      {activeListing && <ListingDetailOverlay listing={activeListing} onClose={() => setActiveListing(null)} />}
    </div>
  );
}
