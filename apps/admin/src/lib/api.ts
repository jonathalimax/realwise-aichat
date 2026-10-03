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

export const getTenants = () => request("/admin/tenants");
export const getTenantDetail = (id: string) => request(`/admin/tenants/${id}`);
export const getTenantKnowledge = (id: string) => request(`/admin/tenants/${id}/knowledge`);
export const getTenantDocumentMarkdown = (id: string, documentId: string) =>
  request(`/admin/tenants/${id}/documents/${documentId}/markdown`);
export const getTenantListings = (id: string, limit?: number, offset?: number) =>
  request(`/admin/tenants/${id}/listings?limit=${limit ?? 50}&offset=${offset ?? 0}`);
export const suspendTenant = (id: string) => request(`/admin/tenants/${id}/suspend`, { method: "POST" });
export const bulkSuspendTenants = (ids: string[]) =>
  request("/admin/tenants/bulk-suspend", { method: "PATCH", body: JSON.stringify({ ids }) });
export const getGlobalMetrics = () => request("/admin/metrics");
export const getMetricsTimeseries = (days?: number) => request(`/admin/metrics/timeseries${days ? `?days=${days}` : ""}`);
export const getConfidenceDistribution = () => request("/admin/metrics/confidence-distribution");
export const getExtractionCostMetrics = (days?: number) =>
  request(`/admin/metrics/extraction-cost${days ? `?days=${days}` : ""}`);
export const getConversationInsights = (days?: number) =>
  request(`/admin/conversations/insights${days ? `?days=${days}` : ""}`);
export const getPlatformConfig = () => request("/admin/platform-config");
export const updatePlatformConfig = (supportWhatsappNumber: string) =>
  request("/admin/platform-config", { method: "PATCH", body: JSON.stringify({ supportWhatsappNumber }) });
export const verifyAdminFirebaseToken = (idToken: string) =>
  request("/auth/admin/verify", { method: "POST", body: JSON.stringify({ idToken }) });
export const logout = () => request("/auth/admin/logout", { method: "POST" });
