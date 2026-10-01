const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

async function request(path: string, options?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: { "content-type": "application/json", ...options?.headers },
    cache: "no-store",
  });
  if (res.status === 401 && typeof window !== "undefined" && window.location.pathname !== "/login") {
    window.location.href = "/login";
  }
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

export const updateBusiness = (data: Record<string, unknown>) =>
  request("/businesses/me", { method: "PATCH", body: JSON.stringify(data) });
export const checkSlugAvailable = (slug: string) => request(`/businesses/slug-available/${slug}`);
export const setBusinessSlug = (slug: string) => request("/businesses/me/slug", { method: "PATCH", body: JSON.stringify({ slug }) });
export const publishBusiness = () => request("/businesses/me/publish", { method: "POST" });
export const confirmLinkPlaced = () => request("/businesses/me/link-placed", { method: "POST" });

export const getWhatsappNumbers = () => request("/businesses/me/whatsapp-numbers");
export const addWhatsappNumber = (label: string, phone: string) =>
  request("/businesses/me/whatsapp-numbers", { method: "POST", body: JSON.stringify({ label, phone }) });
export const removeWhatsappNumber = (id: string) => request(`/businesses/me/whatsapp-numbers/${id}`, { method: "DELETE" });

export const getOnboardingProfile = () => request("/onboarding/profile");
export const patchProfileField = (fieldKey: string, value: unknown, source: string) =>
  request("/onboarding/profile/field", { method: "POST", body: JSON.stringify({ fieldKey, value, source }) });
export const approveProfileField = (fieldKey: string) =>
  request("/onboarding/profile/field/approve", { method: "POST", body: JSON.stringify({ fieldKey }) });
export const recomputeConfidence = () => request("/onboarding/confidence/recompute", { method: "POST" });

export const uploadDocumentFile = async (file: File) => {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_URL}/knowledge/documents/upload`, { method: "POST", credentials: "include", body: form });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
};
export const uploadDocumentText = (filename: string, content: string) =>
  request("/knowledge/documents/text", { method: "POST", body: JSON.stringify({ filename, content }) });

export const getAppointments = () => request("/bookings/appointments");
export const updateAppointmentStatus = (id: string, status: string) =>
  request(`/bookings/appointments/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
