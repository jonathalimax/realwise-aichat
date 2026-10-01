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
