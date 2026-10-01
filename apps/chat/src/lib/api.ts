const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function request(path: string, options?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: { "content-type": "application/json", ...options?.headers },
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

export function getBusiness(slug: string) {
  return request(`/businesses/public/${slug}`);
}

export function getChips(businessId: string) {
  return request(`/chat/${businessId}/chips`);
}

export function startConversation(businessId: string) {
  return request(`/chat/${businessId}/conversations`, { method: "POST" });
}

export function sendMessage(businessId: string, conversationId: string, text: string) {
  return request(`/chat/${businessId}/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

// Streams the assistant's reply via SSE, calling onDelta as text arrives, and resolves with the
// final "done" event payload (message metadata, chips, escalation info).
export async function streamMessage(
  businessId: string,
  conversationId: string,
  text: string,
  onDelta: (text: string) => void,
): Promise<any> {
  const res = await fetch(`${API_URL}/chat/${businessId}/conversations/${conversationId}/messages/stream`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok || !res.body) throw new Error(`Request failed: ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: any = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
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
}

export function bookAppointment(businessId: string, conversationId: string, serviceName: string, startsAt: string, endsAt: string) {
  return request(`/chat/${businessId}/conversations/${conversationId}/book`, {
    method: "POST",
    body: JSON.stringify({ serviceName, startsAt, endsAt }),
  });
}

export function identifyVisitor(businessSlug: string, name: string, phone: string): Promise<{ lead: any }> {
  return request(`/auth/visitor/identify`, {
    method: "POST",
    body: JSON.stringify({ businessSlug, name, phone }),
  });
}
