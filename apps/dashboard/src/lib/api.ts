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
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.message ?? `Request failed: ${res.status}`);
  }
  return res.json();
}

export const getMe = () => request("/businesses/me");
export const getLeads = () => request("/leads");
export const getLeadDetail = (id: string) => request(`/leads/${id}`);
export const getLeadWhatsappLink = (id: string, topic: string) =>
  request(`/leads/${id}/whatsapp-link`, { method: "POST", body: JSON.stringify({ topic }) });
export const getAnalyticsSummary = () => request("/analytics/summary");
export const getAnalyticsTimeseries = (days?: number) => request(`/analytics/timeseries${days ? `?days=${days}` : ""}`);
export const getTopQuestions = () => request("/analytics/top-questions");
export const getAnalyticsInsights = () => request("/analytics/insights");
export const getDocuments = () => request("/knowledge/documents");
export const getUnanswered = () => request("/knowledge/unanswered");
export const getPlans = () => request("/billing/plans");
export const startCheckout = (planCode: string) =>
  request("/billing/checkout", { method: "POST", body: JSON.stringify({ planCode }) });
export const openBillingPortal = () => request("/billing/portal", { method: "POST" });
export const verifyFirebaseToken = (idToken: string) =>
  request("/auth/business/verify", { method: "POST", body: JSON.stringify({ idToken }) });
export const logout = () => request("/auth/business/logout", { method: "POST" });

export const updateBusiness = (data: Record<string, unknown>) =>
  request("/businesses/me", { method: "PATCH", body: JSON.stringify(data) });
export const checkSlugAvailable = (slug: string) => request(`/businesses/slug-available/${slug}`);
export const setBusinessSlug = (slug: string) => request("/businesses/me/slug", { method: "PATCH", body: JSON.stringify({ slug }) });
export const publishBusiness = () => request("/businesses/me/publish", { method: "POST" });
export const confirmLinkPlaced = () => request("/businesses/me/link-placed", { method: "POST" });

export const updateWebsiteUrl = (websiteUrl: string) =>
  request("/businesses/me", { method: "PATCH", body: JSON.stringify({ websiteUrl }) });

export const updateFinancingRate = (financingRatePercent: number | null) =>
  request("/businesses/me", { method: "PATCH", body: JSON.stringify({ financingRatePercent }) });

export const updateBranding = (logoUrl: string, brandColor: string) =>
  request("/businesses/me/branding", { method: "PATCH", body: JSON.stringify({ logoUrl, brandColor }) });

export const getWhatsappNumbers = () => request("/businesses/me/whatsapp-numbers");
export const addWhatsappNumber = (label: string, phone: string) =>
  request("/businesses/me/whatsapp-numbers", { method: "POST", body: JSON.stringify({ label, phone }) });
export const updateWhatsappNumber = (id: string, label: string, phone: string) =>
  request(`/businesses/me/whatsapp-numbers/${id}`, { method: "PATCH", body: JSON.stringify({ label, phone }) });
export const removeWhatsappNumber = (id: string) => request(`/businesses/me/whatsapp-numbers/${id}`, { method: "DELETE" });

export const getOnboardingProfile = () => request("/onboarding/profile");
export const interviewChat = (history: { role: "owner" | "clara"; content: string }[]) =>
  request("/onboarding/interview", { method: "POST", body: JSON.stringify({ history }) });
export const patchProfileField = (fieldKey: string, value: unknown, source: string) =>
  request("/onboarding/profile/field", { method: "POST", body: JSON.stringify({ fieldKey, value, source }) });
export const approveProfileField = (fieldKey: string) =>
  request("/onboarding/profile/field/approve", { method: "POST", body: JSON.stringify({ fieldKey }) });
export const recomputeConfidence = () => request("/onboarding/confidence/recompute", { method: "POST" });
export const updateCustomInstructions = (customInstructions: string) =>
  request("/onboarding/custom-instructions", { method: "PATCH", body: JSON.stringify({ customInstructions }) });

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

export const getCalendarStatus = (businessId: string) => request(`/calendar/${businessId}/status`);

export const getAvailabilityRules = () => request("/bookings/availability");
export const upsertAvailabilityRule = (data: Record<string, unknown>) =>
  request("/bookings/availability", { method: "POST", body: JSON.stringify(data) });
export const deleteAvailabilityRule = (id: string) => request(`/bookings/availability/${id}`, { method: "DELETE" });

export const askOwnerAssistant = (message: string, history: { role: "owner" | "assistant"; content: string }[]) =>
  request("/owner-assistant/ask", { method: "POST", body: JSON.stringify({ message, history }) });
export const getCalendarAuthUrl = (businessId: string) => request(`/calendar/${businessId}/auth-url`);

export const getInboxConversations = (filter?: "all" | "escalated") =>
  request(`/inbox/conversations${filter ? `?filter=${filter}` : ""}`);
export const getInboxThread = (id: string) => request(`/inbox/conversations/${id}`);
export const sendInboxMessage = (id: string, text: string) =>
  request(`/inbox/conversations/${id}/messages`, { method: "POST", body: JSON.stringify({ text }) });
export const markInboxRead = (id: string) => request(`/inbox/conversations/${id}/read`, { method: "POST" });

export const getListings = (filters?: { status?: string; listingType?: string }) => {
  const params = new URLSearchParams();
  if (filters?.status) params.set("status", filters.status);
  if (filters?.listingType) params.set("listingType", filters.listingType);
  const qs = params.toString();
  return request(`/listings${qs ? `?${qs}` : ""}`);
};
export const getListing = (id: string) => request(`/listings/${id}`);
export const updateListing = (id: string, data: Record<string, unknown>) =>
  request(`/listings/${id}`, { method: "PATCH", body: JSON.stringify(data) });
export const createListing = (data: Record<string, unknown>) =>
  request("/listings", { method: "POST", body: JSON.stringify(data) });
export const deleteListing = (id: string) => request(`/listings/${id}`, { method: "DELETE" });
export const reextractListings = () => request("/listings/extract", { method: "POST" });
