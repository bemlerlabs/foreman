/**
 * Node-22-kompatibler Raw-fetch-REST-Wrapper für die NEAR Intents Agent API.
 *
 * Warum own-fetch statt SDK zur Laufzeit: Das SDK deklariert `engines: node>=24`, wir bauen auf
 * Node 22. Die API ist reines JSON über HTTPS (GET {base}/llms.txt, /openapi.json) — der
 * Raw-HTTP-Pfad aus github.com/NEAR-Intents-Agent-API/examples (Kapitel 09) ist die
 * reproduzierbarste Implementierung. Das SDK bleibt als Dev-/Helper-Dependency
 * (createGrantCredential/createIdempotencyKey), alle HTTP-Aufrufe laufen hier.
 *
 * Header-Konventionen (09-raw-http/README.md):
 * - `X-API-Key` auf jeder authentifizierten Anfrage. Der Key verlässt diese Datei nie.
 * - `Idempotency-Key` auf Writes, die Arbeit erzeugen (8–128 Zeichen A-Za-z0-9._:-).
 * - `X-Grant-Token` auf delegierten Aktionen (swap/transfer/withdraw live).
 * - Errors sind JSON:API: errors[0].{status,code,layer,title,detail,meta.retryable}.
 *   Branch NUR auf code, nie auf title/detail.
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
    /** JSON:API-Dokument, secrets-redacted. */
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
  /** Idempotency-Key für Writes, die Arbeit erzeugen. */
  idempotencyKey?: string;
  /** ngt_… Grant-Token für delegierte Aktionen. Wird nie geloggt. */
  grantToken?: string;
  timeoutMs?: number;
  /** Öffentliche Reads (/v1/tokens, /v1/network) gehen ohne API-Key. */
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
      // Netzwerkfehler/Timeout: Antwort könnte trotzdem eingetroffen sein → niemals
      // neuen Idempotency-Key erzeugen; Aufrufer muss mit gleichem Key reconcilieren.
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
    const wait = Math.min(opts.waitMs ?? 30_000, 30_000); // wait_ms ist serverseitig bei 30s gekappt
    const q = new URLSearchParams({ correlation_id: correlationId, wait_ms: String(wait) });
    if (opts.refresh) q.set("refresh", "true");
    return this.request<StatusResponse>({ path: `/v1/status?${q}`, timeoutMs: wait + 15_000 });
  }

  // ---------- Owner-Intents (Mensch signiert — NIE automatisch) ----------
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
  /** dry:true braucht weder Grant noch Idempotency-Key; live beides. */
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

/** Idempotency-Keys: 8–128 Zeichen aus A-Za-z0-9._:- (API-Validierung). */
export function assertIdempotencyKey(key: string): void {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new Error("Idempotency-Key muss 8–128 Zeichen aus [A-Za-z0-9._:-] sein");
  }
}
