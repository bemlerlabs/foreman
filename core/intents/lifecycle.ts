/**
 * Quote-/Execution-Lifecycle: Idempotenz, Statusmaschine, bounded Retries, Quota-Respekt.
 *
 * Referenzen: examples-Repo 05-money-moves (Idempotenz: „auf Transportfehler mit demSELBEN Key
 * erneut senden — nie mit neuem"), 08-errors-and-recovery (Klassifikation poll/settled/
 * waiting-external/reconcile/review), llms.txt (UNCERTAIN nie neu senden; NEEDS_REVIEW nicht
 * pollend aussitzen; Quota 100 Agent-Admissionen/24 h, 1.000 Custody-Ops/Wallet/24 h).
 *
 * Interne Zustände (Mission): PENDING | UNCERTAIN | NEEDS_REVIEW | COMPLETED (+ FAILED terminal).
 * - API QUEUED/PROCESSING/PENDING_SIGNATURE/PENDING_APPROVAL/PENDING_DEPOSIT → PENDING
 * - API SUCCESS/REFUNDED → COMPLETED
 * - API FAILED → FAILED (details.never_executed/never_submitted ⇒ neuer Versuch mit NEUEM Key)
 * - API UNCERTAIN → UNCERTAIN (nur gleiches correlation_id beobachten, NIE neuer Key)
 * - API NEEDS_REVIEW → NEEDS_REVIEW (Polling stoppen, Reason prüfen, nie automatisch retryn)
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { STATE_DIR } from "./env.js";
import { ApiError, type IntentsClient, type StatusResponse } from "./client.js";

export type LifecycleState = "PENDING" | "UNCERTAIN" | "NEEDS_REVIEW" | "COMPLETED" | "FAILED";

const STATUS_MAP: Record<string, LifecycleState> = {
  QUEUED: "PENDING",
  PROCESSING: "PENDING",
  PENDING_SIGNATURE: "PENDING",
  PENDING_APPROVAL: "PENDING",
  PENDING_DEPOSIT: "PENDING",
  SUCCESS: "COMPLETED",
  REFUNDED: "COMPLETED",
  FAILED: "FAILED",
  UNCERTAIN: "UNCERTAIN",
  NEEDS_REVIEW: "NEEDS_REVIEW",
};

export function toLifecycleStatus(apiStatus: string): LifecycleState {
  return STATUS_MAP[apiStatus] ?? "NEEDS_REVIEW"; // unbekannter Status → konservativ prüfen
}

export function isSettled(state: LifecycleState): boolean {
  return state === "COMPLETED" || state === "FAILED" || state === "NEEDS_REVIEW";
}

/** Deterministischer, für diese Operation stabiler Idempotency-Key. */
export function newIdempotencyKey(purpose: string): string {
  const clean = purpose.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 64);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `foreman-${clean}-${stamp}-${randomBytes(6).toString("hex")}`; // ≤128 Zeichen, Alphabet ok
}

export type OperationRecord = {
  key: string; // unsere Operations-Id (z.B. quote-demo-…)
  idempotencyKey: string; // der gegenüber der API verwendete Key — pro Operation stabil
  correlationId?: string;
  purpose: string;
  state: LifecycleState | "DISPATCHING";
  apiStatus?: string;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
  /** Redacted: keine Secrets, nur IDs/Status. */
  details?: Record<string, unknown>;
};

const OPS_FILE = path.join(STATE_DIR, "operations.json");

function loadOps(): Record<string, OperationRecord> {
  if (!existsSync(OPS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(OPS_FILE, "utf8")) as Record<string, OperationRecord>;
  } catch {
    return {};
  }
}

function saveOps(ops: Record<string, OperationRecord>): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  // Rote Liste für die Evidenz: dieser Store enthält nur IDs/Status — keine Keys, keine Tokens.
  writeFileSync(OPS_FILE, JSON.stringify(ops, null, 2), { mode: 0o600 });
}

/**
 * Persist-before-dispatch: liefert den bestehenden Key für `key` zurück oder legt genau einen
 * an. Ein Retry derselben logischen Operation MUSS denselben Idempotency-Key verwenden.
 */
export function operationFor(key: string, purpose: string): OperationRecord {
  const ops = loadOps();
  const existing = ops[key];
  if (existing) return existing;
  const record: OperationRecord = {
    key,
    idempotencyKey: newIdempotencyKey(purpose),
    purpose,
    state: "DISPATCHING",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  ops[key] = record;
  saveOps(ops);
  return record;
}

export function updateOperation(key: string, patch: Partial<OperationRecord>): OperationRecord {
  const ops = loadOps();
  const record = ops[key];
  if (!record) throw new Error(`Operation ${key} nicht gefunden`);
  Object.assign(record, patch, { updatedAt: new Date().toISOString() });
  saveOps(ops);
  return record;
}

export function listOperations(): OperationRecord[] {
  return Object.values(loadOps()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Quota-Guard VOR Dispatch (Mission: 100 Admissions/24 h, 1.000 Custody-Ops/24 h).
 * Liest GET /v1/quotas; bei erschöpfter Agent-Admission bricht er ab, statt 429 zu riskieren.
 * Custody-Ops (dry-runs & signings zählen mit!) werden über 429-Behandlung abgesichert.
 */
export async function assertQuotaHeadroom(client: IntentsClient, needsAgentSlot: boolean): Promise<void> {
  const q = await client.quotas().catch(() => null);
  if (!q?.limits || !q.usage) return; // API gibt nichts frei → 429-Pfad genügt
  const agentsCap = q.limits.daily_agents;
  const agentsUsed = q.usage.agents_last_24_hours;
  if (needsAgentSlot && agentsCap !== undefined && agentsUsed !== undefined && agentsUsed >= agentsCap) {
    throw new Error(
      `Agent-Admissions erschöpft (${agentsUsed}/${agentsCap} in 24 h). Heute keine Agent-Erstellung mehr — Lead informieren.`,
    );
  }
}

/** Bounded Retry: sendet NUR mit demselben Key/body und nur bei retryable-Fehlern. */
export async function retryable<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; onRetry?: (attempt: number, err: unknown) => void } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const base = opts.baseDelayMs ?? 2_000;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const retryableErr =
        err instanceof ApiError && (err.retryable || err.httpStatus === 429 || err.httpStatus >= 500 || err.httpStatus === 0);
      if (!retryableErr || i === attempts - 1) break; // nicht retrybar → sofort raus (gleicher Key bleibt gespeichert)
      opts.onRetry?.(i + 1, err);
      await sleep(base * 2 ** i);
    }
  }
  throw lastErr;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type TrackResult = {
  correlationId: string;
  state: LifecycleState;
  apiStatus: string;
  failureCode?: string | null;
  polls: number;
  status: StatusResponse;
  /** true wenn Polling das Zeitlimit erreichte ohne Terminalstatus. */
  capped: boolean;
};

/**
 * Bounded Polling bis Settled-Status. UNCERTAIN/NEEDS_REVIEW stoppen sofort (Regel: nicht
 * aussitzen; reconcile/review ist Menschen-/Backoffice-Aufgabe).
 */
export async function trackOperation(
  client: IntentsClient,
  correlationId: string,
  operationKey: string,
  opts: { maxPolls?: number; waitMs?: number } = {},
): Promise<TrackResult> {
  const maxPolls = opts.maxPolls ?? 12; // 12 × ≤30 s Long-Poll ≈ 6 Minuten — Timelock-Demo passt rein
  let polls = 0;
  let status: StatusResponse = { correlation_id: correlationId, type: "unknown", status: "QUEUED" };
  while (polls < maxPolls) {
    polls++;
    status = await client.getStatus(correlationId, { waitMs: opts.waitMs ?? 30_000 });
    const state = toLifecycleStatus(status.status);
    updateOperation(operationKey, {
      correlationId,
      state,
      apiStatus: status.status,
      failureCode: status.failure_code ?? undefined,
    });
    if (state !== "PENDING") {
      return {
        correlationId,
        state,
        apiStatus: status.status,
        failureCode: status.failure_code,
        polls,
        status,
        capped: false,
      };
    }
  }
  return { correlationId, state: "PENDING", apiStatus: status.status, polls, status, capped: true };
}
