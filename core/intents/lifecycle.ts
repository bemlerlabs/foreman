/**
 * Quote/execution lifecycle: idempotency, state machine, bounded retries, quota respect.
 *
 * References: examples repo 05-money-moves (idempotency: "on a transport error resend with
 * the SAME key — never a new one"), 08-errors-and-recovery (classification poll/settled/
 * waiting-external/reconcile/review), llms.txt (never resend on UNCERTAIN; never poll
 * through NEEDS_REVIEW; quota 100 agent admissions/24 h, 1,000 custody ops/wallet/24 h).
 *
 * Internal states (mission): PENDING | UNCERTAIN | NEEDS_REVIEW | COMPLETED (+ FAILED terminal).
 * - API QUEUED/PROCESSING/PENDING_SIGNATURE/PENDING_APPROVAL/PENDING_DEPOSIT → PENDING
 * - API SUCCESS/REFUNDED → COMPLETED
 * - API FAILED → FAILED (details.never_executed/never_submitted ⇒ new attempt with a NEW key)
 * - API UNCERTAIN → UNCERTAIN (only observe the same correlation_id, NEVER a new key)
 * - API NEEDS_REVIEW → NEEDS_REVIEW (stop polling, check the reason, never auto-retry)
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
  return STATUS_MAP[apiStatus] ?? "NEEDS_REVIEW"; // unknown status → conservatively review
}

export function isSettled(state: LifecycleState): boolean {
  return state === "COMPLETED" || state === "FAILED" || state === "NEEDS_REVIEW";
}

/** Idempotency key: stable for this operation. */
export function newIdempotencyKey(purpose: string): string {
  const clean = purpose.replace(/[^A-Za-z0-9._:-]/g, "-").slice(0, 64);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  return `foreman-${clean}-${stamp}-${randomBytes(6).toString("hex")}`; // ≤128 chars, alphabet ok
}

export type OperationRecord = {
  key: string; // our operation id (e.g. quote-demo-…)
  idempotencyKey: string; // the key used against the API — stable per operation
  correlationId?: string;
  purpose: string;
  state: LifecycleState | "DISPATCHING";
  apiStatus?: string;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
  /** Redacted: no secrets, only ids/status. */
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
  // Evidence red line: this store holds only ids/status — no keys, no tokens.
  writeFileSync(OPS_FILE, JSON.stringify(ops, null, 2), { mode: 0o600 });
}

/**
 * Persist-before-dispatch: returns the existing key for `key` or creates exactly one.
 * A retry of the same logical operation MUST use the same idempotency key.
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
  if (!record) throw new Error(`Operation ${key} not found`);
  Object.assign(record, patch, { updatedAt: new Date().toISOString() });
  saveOps(ops);
  return record;
}

export function listOperations(): OperationRecord[] {
  return Object.values(loadOps()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/**
 * Quota guard BEFORE dispatch (mission: 100 admissions/24 h, 1,000 custody ops/24 h).
 * Reads GET /v1/quotas; aborts when agent admissions are exhausted instead of risking 429.
 * Custody ops (dry-runs & signings count too!) are covered by 429 handling.
 */
export async function assertQuotaHeadroom(client: IntentsClient, needsAgentSlot: boolean): Promise<void> {
  const q = await client.quotas().catch(() => null);
  if (!q?.limits || !q.usage) return; // API discloses nothing → the 429 path suffices
  const agentsCap = q.limits.daily_agents;
  const agentsUsed = q.usage.agents_last_24_hours;
  if (needsAgentSlot && agentsCap !== undefined && agentsUsed !== undefined && agentsUsed >= agentsCap) {
    throw new Error(
      `Agent admissions exhausted (${agentsUsed}/${agentsCap} in 24 h). No more agent creation today — inform the lead.`,
    );
  }
}

/** Bounded retry: sends ONLY with the same key/body and only on retryable errors. */
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
      if (!retryableErr || i === attempts - 1) break; // not retryable → exit now (same key stays persisted)
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
  /** true when polling hit the time limit without a terminal status. */
  capped: boolean;
};

/**
 * Bounded polling until a settled status. UNCERTAIN/NEEDS_REVIEW stop immediately (rule:
 * never poll through them; reconcile/review is a human/backoffice task).
 */
export async function trackOperation(
  client: IntentsClient,
  correlationId: string,
  operationKey: string,
  opts: { maxPolls?: number; waitMs?: number } = {},
): Promise<TrackResult> {
  const maxPolls = opts.maxPolls ?? 12; // 12 × ≤30 s long-poll ≈ 6 minutes — the timelock demo fits
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
