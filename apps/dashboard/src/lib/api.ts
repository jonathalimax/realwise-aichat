const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function request(path: string, options?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: { "content-type": "application/json", ...options?.headers },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

export const getMe = () => request("/businesses/me");
export const getLeads = () => request("/leads");
export const getLeadDetail = (id: string) => request(`/leads/${id}`);
export const getLeadWhatsappLink = (id: string, topic: string) =>
  request(`/leads/${id}/whatsapp-link`, { method: "POST", body: JSON.stringify({ topic }) });
export const getAnalyticsSummary = () => request("/analytics/summary");
export const getTopQuestions = () => request("/analytics/top-questions");
export const getDocuments = () => request("/knowledge/documents");
export const getUnanswered = () => request("/knowledge/unanswered");
export const getPlans = () => request("/billing/plans");
export const startCheckout = (planCode: string) =>
  request("/billing/checkout", { method: "POST", body: JSON.stringify({ planCode }) });
export const openBillingPortal = () => request("/billing/portal", { method: "POST" });
export const verifyFirebaseToken = (idToken: string) =>
  request("/auth/business/verify", { method: "POST", body: JSON.stringify({ idToken }) });
