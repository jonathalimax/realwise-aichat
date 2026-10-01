const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3006";
const INTERNAL_TOKEN = process.env.INFERENCE_GATEWAY_TOKEN;

export async function callInternalApi(path: string, businessId: string) {
  if (!INTERNAL_TOKEN) return;
  await fetch(`${API_URL}/internal/businesses/${businessId}${path}`, {
    method: "POST",
    headers: { "x-internal-token": INTERNAL_TOKEN },
  }).catch((err) => console.error(`internal API call ${path} failed for ${businessId}`, err));
}
