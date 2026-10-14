const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3006/api";
const INTERNAL_TOKEN = process.env.INFERENCE_GATEWAY_TOKEN;

export async function callInternalApi(path: string, businessId: string) {
  if (!INTERNAL_TOKEN) return;
  await fetch(`${API_URL}/internal/businesses/${businessId}${path}`, {
    method: "POST",
    headers: { "x-internal-token": INTERNAL_TOKEN },
  }).catch((err) => console.error(`internal API call ${path} failed for ${businessId}`, err));
}

/**
 * Like callInternalApi but for jobs that must be retried: throws on network errors and non-2xx, and
 * allows long-running endpoints (catalog import apply). `path` is relative to the API base, e.g.
 * "/internal/pharmacy/retention-purge".
 */
export async function postInternalApi(path: string, timeoutMs = 10 * 60_000): Promise<unknown> {
  if (!INTERNAL_TOKEN) throw new Error("INFERENCE_GATEWAY_TOKEN is not set: cannot call the internal API");
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "x-internal-token": INTERNAL_TOKEN },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`internal API ${path} responded ${res.status}`);
  return res.json().catch(() => ({}));
}
