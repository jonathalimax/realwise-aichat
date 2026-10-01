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
export const suspendTenant = (id: string) => request(`/admin/tenants/${id}/suspend`, { method: "POST" });
export const getGlobalMetrics = () => request("/admin/metrics");
export const verifyAdminFirebaseToken = (idToken: string) =>
  request("/auth/admin/verify", { method: "POST", body: JSON.stringify({ idToken }) });
