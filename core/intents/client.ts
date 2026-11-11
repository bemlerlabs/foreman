/**
 * Node-22-compatible raw-fetch REST wrapper for the NEAR Intents Agent API.
 *
 * Why own fetch instead of the SDK at runtime: the SDK declares `engines: node>=24`, we build on
 * Node 22. The API is pure JSON over HTTPS (GET {base}/llms.txt, /openapi.json) — the
 * raw HTTP path from github.com/NEAR-Intents-Agent-API/examples (chapter 09) is the most
 * reproducible implementation. The SDK stays as a dev/helper dependency
 * (createGrantCredential/createIdempotencyKey); all HTTP calls run here.
 *
 * Header conventions (09-raw-http/README.md):
 * - `X-API-Key` on every authenticated request. The key never leaves this file.
 * - `Idempotency-Key` on writes that create work (8–128 chars A-Za-z0-9._:-).
 * - `X-Grant-Token` on delegated actions (swap/transfer/withdraw live).
 * - Errors are JSON:API: errors[0].{status,code,layer,title,detail,meta.retryable}.
 *   Branch ONLY on code, never on title/detail.
 */
import { redact, type TreasuryConfig } from "./env.js";

export type ApiErrorDoc = {
  status?: number;
  code?: string;
  layer?: string;
  title?: string;
  detail?: string;
  source?: { pointer?: string };
  meta?: { retryable?: boolean; available_at?: string };
};

export class ApiError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    readonly layer: string | undefined,
    readonly retryable: boolean,
    readonly availableAt: string | undefined,
    readonly requestId: string | undefined,
    /** JSON:API document, secrets-redacted. */
    readonly document: unknown,
  ) {
    super(`intents_api_error http=${httpStatus} code=${code}${layer ? ` layer=${layer}` : ""}`);
    this.name = "ApiError";
  }
}

export type StatusResponse = {
  correlation_id: string;
  type: string;
  status: string;
  failure_code?: string | null;
  agent_id?: string | null;
  details?: Record<string, unknown> | null;
  grant?: Record<string, unknown> | null;
  dispatch_committed_at?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type GenerateIntentResponse = {
  correlation_id: string;
  type: string;
  signer: { type: string; account_id?: string; public_key?: string; address?: string };
  intent: { standard: string; payload: unknown };
  preview?: unknown;
  expires_at?: string;
};

export type PolicyView = {
  revision: number | null;
  status: string | null;
  provider_policy_synced: boolean | null;
  policy: Record<string, unknown> | null;
  usage?: {
    budget?: Record<string, unknown> | null;
    timelock?: Record<string, unknown> | null;
  } | null;
  cooldowns?: Record<string, unknown> | null;
};

type RequestSpec = {
  method?: "GET" | "POST" | "DELETE";
  path: string;
  body?: unknown;
  /** Idempotency key for writes that create work. */
  idempotencyKey?: string;
  /** ngt_… grant token for delegated actions. Never logged. */
  grantToken?: string;
  timeoutMs?: number;
  /** Public reads (/v1/tokens, /v1/network) go without an API key. */
  allowMissingKey?: boolean;
};

export class IntentsClient {
  constructor(private readonly cfg: TreasuryConfig) {}

  get baseUrl(): string {
    return this.cfg.baseUrl;
  }

  async request<T>(spec: RequestSpec): Promise<T> {
    const headers = new Headers();
    const secrets: string[] = [this.cfg.apiKey];
    if (spec.grantToken) secrets.push(spec.grantToken);
    if (!spec.allowMissingKey) headers.set("x-api-key", this.cfg.apiKey);
    else if (this.cfg.apiKey) headers.set("x-api-key", this.cfg.apiKey);
    if (spec.grantToken) headers.set("x-grant-token", spec.grantToken);
    if (spec.idempotencyKey) {
      assertIdempotencyKey(spec.idempotencyKey);
      headers.set("idempotency-key", spec.idempotencyKey);
    }
    if (spec.body !== undefined) headers.set("content-type", "application/json");

    let response: Response;
    try {
      response = await fetch(`${this.cfg.baseUrl}${spec.path}`, {
        method: spec.method ?? "GET",
        headers,
        body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
        redirect: "error",
        signal: AbortSignal.timeout(spec.timeoutMs ?? 65_000),
      });
    } catch (e) {
      // Network error/timeout: the response may still have arrived → never generate a
      // new idempotency key; the caller must reconcile with the same key.
      throw new ApiError(0, redact(String((e as Error)?.name ?? "network_error"), secrets), undefined, true, undefined, undefined, {
        note: "transport failure — outcome unknown; retry only with the SAME Idempotency-Key or observe status",
      });
    }

    const text = await response.text();
    let doc: unknown = null;
    if (text) {
      try {
        doc = JSON.parse(redact(text, secrets));
      } catch {
        doc = { raw: redact(text.slice(0, 2000), secrets) };
      }
    }
    if (!response.ok) {
      const errors = (doc as { errors?: ApiErrorDoc[] } | null)?.errors;
      const first = errors?.[0];
      throw new ApiError(
        response.status,
        first?.code ?? `http_${response.status}`,
        first?.layer,
        first?.meta?.retryable === true,
        first?.meta?.available_at,
        (doc as { meta?: { request_id?: string } } | null)?.meta?.request_id,
        doc,
      );
    }
    return doc as T;
  }

  // ---------- Reads ----------
  whoami() {
    return this.request<{ api_key_id: string; tenant_id: string }>({ path: "/v1/whoami" });
  }
  network() {
    return this.request<Record<string, unknown>>({ path: "/v1/network", allowMissingKey: true });
  }
  tokens() {
    return this.request<{ data: Array<Record<string, unknown>> }>({ path: "/v1/tokens", allowMissingKey: true });
  }
  quotas() {
    return this.request<{
      limits?: Record<string, number>;
      usage?: Record<string, number>;
      observed_at?: string;
    }>({ path: "/v1/quotas" });
  }
  listAgents() {
    return this.request<{ data: Array<Record<string, unknown>> }>({ path: "/v1/agents" });
  }
  getAgent(agentId: string) {
    return this.request<Record<string, unknown>>({ path: `/v1/agents/${encodeURIComponent(agentId)}` });
  }
  getPolicy(agentId: string) {
    return this.request<PolicyView>({ path: `/v1/agents/${encodeURIComponent(agentId)}/policy` });
  }
  getHistory(agentId: string, limit = 10) {
    return this.request<{ data: StatusResponse[] }>({
      path: `/v1/agents/${encodeURIComponent(agentId)}/history?limit=${limit}`,
    });
  }
  getStatus(correlationId: string, opts: { waitMs?: number; refresh?: boolean } = {}) {
    const wait = Math.min(opts.waitMs ?? 30_000, 30_000); // wait_ms is capped server-side at 30s
    const q = new URLSearchParams({ correlation_id: correlationId, wait_ms: String(wait) });
    if (opts.refresh) q.set("refresh", "true");
    return this.request<StatusResponse>({ path: `/v1/status?${q}`, timeoutMs: wait + 15_000 });
  }

  // ---------- owner intents (human signs — NEVER automatically) ----------
  generateIntent(body: Record<string, unknown>, idempotencyKey?: string) {
    return this.request<GenerateIntentResponse>({
      method: "POST",
      path: "/v1/generate-intent",
      body,
      idempotencyKey,
    });
  }
  submitIntent(body: { type: string; correlation_id: string; signed_data: unknown }) {
    return this.request<StatusResponse>({
      method: "POST",
      path: "/v1/submit-intent",
      body,
    });
  }

  // ---------- Executions ----------
  /** dry:true needs neither grant nor idempotency key; live needs both. */
  swap(agentId: string, body: Record<string, unknown>, opts: { idempotencyKey?: string; grantToken?: string } = {}) {
    return this.request<QuoteResponse | StatusResponse>({
      method: "POST",
      path: `/v1/agents/${encodeURIComponent(agentId)}/swap`,
      body,
      idempotencyKey: opts.idempotencyKey,
      grantToken: opts.grantToken,
    });
  }
}

export type QuoteResponse = {
  dry: true;
  type: string;
  correlation_id?: string;
  quote?: Record<string, unknown> | null;
  spend?: { amount_usd?: string | null; budget?: unknown } | null;
  fee?: { amount_usd?: string | null; percent?: string | null } | null;
  warnings?: Array<Record<string, unknown>> | null;
  owner_approval?: boolean;
};

/** Idempotency keys: 8–128 chars from A-Za-z0-9._:- (API validation). */
export function assertIdempotencyKey(key: string): void {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new Error("Idempotency-Key must be 8–128 chars from [A-Za-z0-9._:-]");
  }
}
