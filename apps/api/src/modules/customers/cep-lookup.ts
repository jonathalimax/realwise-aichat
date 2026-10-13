import { normalizeCep } from "./address-utils";

export interface CepResult {
  /** 8 digits */
  cep: string;
  /** May be empty for generic (whole-city) CEPs: the UI then asks for the street. */
  street: string;
  district: string;
  city: string;
  /** UF, e.g. "PR" */
  state: string;
  provider: "viacep" | "brasilapi";
}

export type CepLookupOutcome =
  | { status: "ok"; result: CepResult }
  | { status: "not_found" }
  | { status: "invalid" }
  /** Every provider failed (timeout / network / 5xx): the UI lets the visitor type the address manually. */
  | { status: "unavailable" };

/** A single provider: returns the result, null when the CEP does not exist, throws on infrastructure failure. */
export interface CepLookup {
  readonly name: string;
  lookup(cep8: string): Promise<CepResult | null>;
}

export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
}>;

const DEFAULT_TIMEOUT_MS = 4000;

async function getJson(fetchImpl: FetchLike, url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal, headers: { accept: "application/json" } });
  } finally {
    clearTimeout(timer);
  }
}

export class ViaCepLookup implements CepLookup {
  readonly name = "viacep";
  constructor(
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async lookup(cep8: string): Promise<CepResult | null> {
    const res = await getJson(this.fetchImpl, `https://viacep.com.br/ws/${cep8}/json/`, this.timeoutMs);
    if (res.status === 400 || res.status === 404) return null;
    if (!res.ok) throw new Error(`viacep status ${res.status}`);
    const body = await res.json();
    if (!body || body.erro === true || body.erro === "true") return null;
    if (!body.localidade || !body.uf) throw new Error("viacep malformed response");
    return {
      cep: cep8,
      street: String(body.logradouro ?? "").trim(),
      district: String(body.bairro ?? "").trim(),
      city: String(body.localidade).trim(),
      state: String(body.uf).trim().toUpperCase(),
      provider: "viacep",
    };
  }
}

export class BrasilApiCepLookup implements CepLookup {
  readonly name = "brasilapi";
  constructor(
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async lookup(cep8: string): Promise<CepResult | null> {
    const res = await getJson(this.fetchImpl, `https://brasilapi.com.br/api/cep/v1/${cep8}`, this.timeoutMs);
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`brasilapi status ${res.status}`);
    const body = await res.json();
    if (!body || !body.city || !body.state) throw new Error("brasilapi malformed response");
    return {
      cep: cep8,
      street: String(body.street ?? "").trim(),
      district: String(body.neighborhood ?? "").trim(),
      city: String(body.city).trim(),
      state: String(body.state).trim().toUpperCase(),
      provider: "brasilapi",
    };
  }
}

/**
 * Tries providers in order (ViaCEP, then BrasilAPI). A definite "not found" from any working
 * provider wins over another provider's failure; "unavailable" only when every provider failed.
 */
export class FallbackCepLookup {
  constructor(private readonly providers: CepLookup[]) {
    if (providers.length === 0) throw new Error("FallbackCepLookup needs at least one provider");
  }

  async lookup(input: string): Promise<CepLookupOutcome> {
    const cep8 = normalizeCep(input);
    if (!cep8) return { status: "invalid" };
    let sawNotFound = false;
    for (const provider of this.providers) {
      try {
        const result = await provider.lookup(cep8);
        if (result) return { status: "ok", result };
        sawNotFound = true;
      } catch {
        // infrastructure failure: try the next provider
      }
    }
    return sawNotFound ? { status: "not_found" } : { status: "unavailable" };
  }
}

/** Nest injection token for the CEP lookup (tests / other environments can override). */
export const CEP_LOOKUP = Symbol("CEP_LOOKUP");

export function defaultCepLookup(fetchImpl?: FetchLike): FallbackCepLookup {
  return new FallbackCepLookup([new ViaCepLookup(fetchImpl), new BrasilApiCepLookup(fetchImpl)]);
}
