const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3006/api";

async function request(path: string, options?: RequestInit) {
  // A genuinely stalled connection (dead proxy, saturated inference gateway on the backend) must
  // fail visibly instead of hanging indefinitely — this helper previously had no timeout at all,
  // unlike streamMessage below which already aborts after 45s.
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: { "content-type": "application/json", ...options?.headers },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    // Attach the real HTTP status so callers (e.g. ChatScreen's localStorage self-heal) can
    // distinguish "stale/foreign conversation id" (403/404) from a transient network failure.
    const error = new Error(`Request failed: ${res.status}`) as Error & { status?: number; data?: any };
    error.status = res.status;
    // Additive: the parsed error body (Nest shape, plus the domain `code`/`message` the pharmacy
    // forms show inline). Never required by existing callers.
    error.data = await res.json().catch(() => null);
    throw error;
  }
  return res.json();
}

export function getBusiness(slug: string) {
  return request(`/businesses/public/${slug}`);
}

export function startConversation(businessId: string) {
  return request(`/chat/${businessId}/conversations`, { method: "POST" });
}

// `resumeToken` is only needed when opening via a cross-device resume link (?c=&t=); the cookie
// path (same device/browser) authorizes without it.
export function getConversationHistory(businessId: string, conversationId: string, resumeToken?: string) {
  const qs = resumeToken ? `?t=${encodeURIComponent(resumeToken)}` : "";
  return request(`/chat/${businessId}/conversations/${conversationId}/messages${qs}`);
}

// "Selecionar e continuar" — pins a specific listing as this conversation's subject so follow-up
// questions resolve against it directly instead of the ambiguous message-history lookback.
export function pinListing(businessId: string, conversationId: string, listingId: string) {
  return request(`/chat/${businessId}/conversations/${conversationId}/listing/pin`, {
    method: "POST",
    body: JSON.stringify({ listingId }),
  });
}

export function sendMessage(businessId: string, conversationId: string, text: string) {
  return request(`/chat/${businessId}/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

// Streams the assistant's reply via SSE, calling onDelta as text arrives, and resolves with the
// final "done" event payload (message metadata, escalation info).
export async function streamMessage(
  businessId: string,
  conversationId: string,
  text: string,
  onDelta: (text: string) => void,
): Promise<any> {
  // A genuinely stalled connection (dead proxy, backend hang) must fail visibly into the
  // caller's catch-block error message instead of hanging with a silently-stuck sending state.
  const timeoutController = new AbortController();
  let timeoutId = setTimeout(() => timeoutController.abort(), 45000);
  const armTimeout = () => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => timeoutController.abort(), 45000);
  };
  try {
    const res = await fetch(`${API_URL}/chat/${businessId}/conversations/${conversationId}/messages/stream`, {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: timeoutController.signal,
    });
    if (!res.ok || !res.body) throw new Error(`Request failed: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalResult: any = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      armTimeout();
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const raw of events) {
        const eventMatch = raw.match(/^event: (\w+)/m);
        const dataMatch = raw.match(/^data: (.+)$/m);
        if (!eventMatch || !dataMatch) continue;
        const payload = JSON.parse(dataMatch[1]);
        if (eventMatch[1] === "delta") {
          onDelta(payload.text);
        } else if (eventMatch[1] === "done") {
          finalResult = payload;
        } else if (eventMatch[1] === "error") {
          throw new Error(payload.message ?? "stream_failed");
        }
      }
    }
    return finalResult;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function startFlow(businessId: string, conversationId: string) {
  return request(`/chat/${businessId}/conversations/${conversationId}/flow/start`, { method: "POST" });
}

export function advanceFlow(
  businessId: string,
  conversationId: string,
  goto: string,
  params?: Record<string, unknown>,
  label?: string,
) {
  return request(`/chat/${businessId}/conversations/${conversationId}/flow/advance`, {
    method: "POST",
    body: JSON.stringify({ goto, params, label }),
  });
}

// `alternatives`: extra date+time options the visitor also picked — the earliest chosen option is
// booked, the rest are recorded for the team.
export function bookAppointment(
  businessId: string,
  conversationId: string,
  serviceName: string,
  startsAt: string,
  endsAt: string,
  alternatives: { startsAt: string; endsAt: string }[] = [],
) {
  return request(`/chat/${businessId}/conversations/${conversationId}/book`, {
    method: "POST",
    body: JSON.stringify({ serviceName, startsAt, endsAt, alternatives }),
  });
}

// Select / unselect a listing card. One selection is kept server-side and injected into
// every later answer, so "quanto fica o total?" is answered about the selection.
export function setListingSelection(
  businessId: string,
  conversationId: string,
  listingId: string,
  selected: boolean,
): Promise<{ selectedListingIds: string[]; message: { id: string; content: string } | null; suggestions: string[] }> {
  return request(`/chat/${businessId}/conversations/${conversationId}/selection`, {
    method: "POST",
    body: JSON.stringify({ listingId, selected }),
  });
}

export interface ScheduleSlot {
  startsAt: string;
  endsAt: string;
  label: string;
}

export interface ScheduleDay {
  dateKey: string;
  label: string;
  weekday: string;
  slots: ScheduleSlot[];
}

export interface ScheduleOptions {
  configured: boolean;
  days: ScheduleDay[];
  hasContact: boolean;
  listing: { id: string; title: string } | null;
}

// Days the business attends (from its configured availability) with that day's open time slots.
export function getScheduleOptions(businessId: string, conversationId: string): Promise<ScheduleOptions> {
  return request(`/chat/${businessId}/conversations/${conversationId}/schedule`);
}

// Returns null when the business hasn't connected Google Calendar, so callers fall back to free-text date/time inputs.
export async function getAvailableSlots(businessId: string, date?: string): Promise<{ start: string; end: string }[] | null> {
  const result = await request(`/calendar/${businessId}/slots${date ? `?date=${date}` : ""}`);
  return result.slots ?? null;
}

export function identifyVisitor(businessSlug: string, name: string | null, phone: string, email?: string): Promise<{ lead: { id: string } }> {
  return request(`/auth/visitor/identify`, {
    method: "POST",
    body: JSON.stringify({ businessSlug, name, phone, ...(email ? { email } : {}) }),
  });
}

export function getPushPublicKey(businessId: string): Promise<{ publicKey: string | null }> {
  return request(`/chat/${businessId}/push/public-key`);
}

export function subscribePush(businessId: string, conversationId: string, subscription: unknown) {
  return request(`/chat/${businessId}/conversations/${conversationId}/push/subscribe`, {
    method: "POST",
    body: JSON.stringify(subscription),
  });
}

export function unsubscribePush(businessId: string, conversationId: string, endpoint: string) {
  return request(`/chat/${businessId}/conversations/${conversationId}/push/unsubscribe`, {
    method: "POST",
    body: JSON.stringify({ endpoint }),
  });
}

// ---------------------------------------------------------------------------------------------
// Pharmacy (niche "farmacia"). Contract: docs/pharmacy/API.md sections 8, 8.4, 8.5 and 9.
// ---------------------------------------------------------------------------------------------

// Product image URLs come back as API-relative paths ("/api/public/products/<id>/image?v=…").
export function resolveApiAsset(url: string | null | undefined): string | null {
  if (!url || typeof url !== "string") return null;
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/")) {
    try {
      return new URL(API_URL).origin + url;
    } catch {
      return url;
    }
  }
  return null;
}

// Best human-readable message from a failed request (domain errors carry a pt-BR `message`).
export function apiErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: { message?: unknown } })?.data;
  const message = data?.message;
  if (typeof message === "string" && message.trim()) return message;
  if (Array.isArray(message) && typeof message[0] === "string") return message[0];
  return fallback;
}

export type PharmacyAction = { type: string; [key: string]: unknown };

export function pharmacyAction(businessId: string, conversationId: string, action: PharmacyAction): Promise<{ messages: any[]; pharmacy?: any; suggestions?: string[] }> {
  return request(`/chat/${businessId}/conversations/${conversationId}/pharmacy/actions`, {
    method: "POST",
    body: JSON.stringify(action),
  });
}

export function lookupCustomerPhone(
  businessId: string,
  phone: string,
): Promise<{ recognized: boolean; firstName?: string; address?: { id: string; label: string } | null }> {
  return request(`/customers/${businessId}/lookup`, { method: "POST", body: JSON.stringify({ phone }) });
}

export function lookupCep(
  businessId: string,
  cep: string,
): Promise<{ status: "ok" | "not_found" | "unavailable"; cep?: string; street?: string; district?: string; city?: string; state?: string }> {
  return request(`/customers/${businessId}/cep/${encodeURIComponent(cep)}`);
}

export function getConsentText(businessId: string, purpose: "pharmacy_triage" | "prescription_upload"): Promise<{ purpose: string; version: string; text: string }> {
  return request(`/chat/${businessId}/consent-text?purpose=${purpose}`);
}

// Private upload: multipart, so it bypasses the JSON `request` helper (which pins content-type).
export async function uploadPrescription(
  businessId: string,
  conversationId: string,
  file: File,
  patientName?: string,
): Promise<{ prescription: { id: string; code: string; status: string } }> {
  const form = new FormData();
  form.append("file", file);
  form.append("consent", "true");
  if (patientName?.trim()) form.append("patientName", patientName.trim());
  const res = await fetch(`${API_URL}/chat/${businessId}/conversations/${conversationId}/prescriptions`, {
    method: "POST",
    credentials: "include",
    body: form,
    signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) {
    const error = new Error(`Request failed: ${res.status}`) as Error & { status?: number; data?: any };
    error.status = res.status;
    error.data = await res.json().catch(() => null);
    throw error;
  }
  return res.json();
}

export interface PublicOrderDto {
  code: string;
  status: "pending_pharmacist" | "confirmed" | "out_for_delivery" | "ready_for_pickup" | "delivered" | "canceled" | "rejected";
  statusLabel: string;
  fulfillment: "delivery" | "pickup";
  steps: { key: string; label: string; at: string | null; done: boolean }[];
  canceled: { reason: string; at: string | null } | null;
  items: { name: string; qty: number; unitPriceCents: number }[];
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  paymentLabel: string;
  addressLabel: string | null;
  pharmacy: {
    name: string;
    phone: string | null;
    logoUrl: string | null;
    branding: { primaryColor?: string; secondaryColor?: string; tertiaryColor?: string };
  };
  updatedAt: string;
}

export function getPublicOrder(token: string): Promise<PublicOrderDto> {
  return request(`/public/orders/${encodeURIComponent(token)}`);
}
