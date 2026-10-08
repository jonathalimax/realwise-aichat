const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3006/api";
const BASE_PATH = "/admin";

async function request(path: string, options?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: { "content-type": "application/json", ...options?.headers },
    cache: "no-store",
  });
  if (res.status === 401 && typeof window !== "undefined" && window.location.pathname !== `${BASE_PATH}/login`) {
    window.location.href = `${BASE_PATH}/login`;
  }
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

export const getTenants = () => request("/admin/tenants");
export const getTenantDetail = (id: string) => request(`/admin/tenants/${id}`);
export const getTenantKnowledge = (id: string) => request(`/admin/tenants/${id}/knowledge`);
export const getTenantDocumentMarkdown = (id: string, documentId: string) =>
  request(`/admin/tenants/${id}/documents/${documentId}/markdown`);
export const getTenantListings = (id: string, limit?: number, offset?: number) =>
  request(`/admin/tenants/${id}/listings?limit=${limit ?? 50}&offset=${offset ?? 0}`);
export const getTenantConversations = (id: string, limit?: number, offset?: number) =>
  request(`/admin/tenants/${id}/conversations?limit=${limit ?? 50}&offset=${offset ?? 0}`);
export const getTenantConversationThread = (id: string, conversationId: string) =>
  request(`/admin/tenants/${id}/conversations/${conversationId}`);
export const suspendTenant = (id: string) => request(`/admin/tenants/${id}/suspend`, { method: "POST" });
export const setConversationalMode = (id: string, enabled: boolean) =>
  request(`/admin/tenants/${id}/conversational-mode`, { method: "PATCH", body: JSON.stringify({ enabled }) });
export const bulkSuspendTenants = (ids: string[]) =>
  request("/admin/tenants/bulk-suspend", { method: "PATCH", body: JSON.stringify({ ids }) });
export const getGlobalMetrics = () => request("/admin/metrics");
export const getMetricsTimeseries = (days?: number) => request(`/admin/metrics/timeseries${days ? `?days=${days}` : ""}`);
export const getConfidenceDistribution = () => request("/admin/metrics/confidence-distribution");
export const getExtractionCostMetrics = (days?: number) =>
  request(`/admin/metrics/extraction-cost${days ? `?days=${days}` : ""}`);
export const getConversationCostMetrics = (params: {
  businessId?: string;
  from?: string;
  to?: string;
  sortBy?: "cost" | "date" | "tokens";
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}) => {
  const search = new URLSearchParams();
  if (params.businessId) search.set("businessId", params.businessId);
  if (params.from) search.set("from", params.from);
  if (params.to) search.set("to", params.to);
  if (params.sortBy) search.set("sortBy", params.sortBy);
  if (params.sortOrder) search.set("sortOrder", params.sortOrder);
  search.set("limit", String(params.limit ?? 50));
  search.set("offset", String(params.offset ?? 0));
  return request(`/admin/metrics/conversation-cost?${search.toString()}`);
};
export const getConversationInsights = (days?: number) =>
  request(`/admin/conversations/insights${days ? `?days=${days}` : ""}`);
export const getConversationProblemCases = (params: {
  days: number;
  businessId?: string;
  category?: string;
  limit?: number;
  offset?: number;
}) => {
  const search = new URLSearchParams();
  search.set("days", String(params.days));
  if (params.businessId) search.set("businessId", params.businessId);
  if (params.category) search.set("category", params.category);
  search.set("limit", String(params.limit ?? 25));
  search.set("offset", String(params.offset ?? 0));
  return request(`/admin/conversations/problem-cases?${search.toString()}`);
};
export const getPlatformConfig = () => request("/admin/platform-config");
export const updatePlatformConfig = (supportWhatsappNumber: string) =>
  request("/admin/platform-config", { method: "PATCH", body: JSON.stringify({ supportWhatsappNumber }) });
export const loginAdmin = (email: string, password: string) =>
  request("/auth/admin/verify", { method: "POST", body: JSON.stringify({ email, password }) });
export const logout = () => request("/auth/admin/logout", { method: "POST" });

export const getAdminUsers = () => request("/admin/users");
export const createAdminUser = (data: { email: string; name: string; role: string; password: string }) =>
  request("/admin/users", { method: "POST", body: JSON.stringify(data) });
export const deleteAdminUser = (id: string) => request(`/admin/users/${id}`, { method: "DELETE" });
