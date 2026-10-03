const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3006";

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
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
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

export function advanceFlow(businessId: string, conversationId: string, goto: string, params?: Record<string, unknown>) {
  return request(`/chat/${businessId}/conversations/${conversationId}/flow/advance`, {
    method: "POST",
    body: JSON.stringify({ goto, params }),
  });
}

export function bookAppointment(businessId: string, conversationId: string, serviceName: string, startsAt: string, endsAt: string) {
  return request(`/chat/${businessId}/conversations/${conversationId}/book`, {
    method: "POST",
    body: JSON.stringify({ serviceName, startsAt, endsAt }),
  });
}

// Returns null when the business hasn't connected Google Calendar, so callers fall back to free-text date/time inputs.
export async function getAvailableSlots(businessId: string, date?: string): Promise<{ start: string; end: string }[] | null> {
  const result = await request(`/calendar/${businessId}/slots${date ? `?date=${date}` : ""}`);
  return result.slots ?? null;
}

export function identifyVisitor(businessSlug: string, name: string, phone: string): Promise<{ lead: any }> {
  return request(`/auth/visitor/identify`, {
    method: "POST",
    body: JSON.stringify({ businessSlug, name, phone }),
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
