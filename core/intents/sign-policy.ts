/**
 * Owner policy flow (mission point 3): generate policy → HUMAN signs → submit → status.
 *
 * NO AUTO-SIGNING in this module. It creates the owner intents via
 * POST /v1/generate-intent and prints the signing message (intent.payload) + exact
 * instructions for the human. Signing happens exclusively outside this code:
 *   - in the owner's wallet (recommended), or
 *   - started by the owner themselves via `npm run owner:sign` (owner-sign-helper.ts,
 *     separate file, explicit --i-am-the-owner attestation, reads the owner's key).
 *
 * NEP-366 (DelegateAction) is gasless: the API sponsor submits the transaction —
 * policy edits (budget/destinations/timelock/schedule) even run off-chain (NEP-413,
 * transaction_hash: null). Gas cost for the owner: 0.
 *
 * Usage:
 *   npm run policy:create                          # create agent + policy (owner signature needed)
 *   npm run policy:update                          # change policy (revision is read)
 *   npm run policy:submit -- --cid <cid> --signed <file.json>
 *   npm run policy-status                          # view revision/status/budget usage
 *
 * Persist-before-dispatch: every generated intent is stored at .state/intents/<cid>.json
 * before the first signing step — aborting breaks nothing.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { STATE_DIR, redactJson, treasuryConfig, redact } from "./env.js";
import { IntentsClient, type GenerateIntentResponse } from "./client.js";
import { buildTreasuryPolicy, policySummary } from "./policy.js";
import { assertQuotaHeadroom, newIdempotencyKey, toLifecycleStatus } from "./lifecycle.js";

const INTENTS_DIR = path.join(STATE_DIR, "intents");

function saveIntent(generated: GenerateIntentResponse): string {
  mkdirSync(INTENTS_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(INTENTS_DIR, `${generated.correlation_id}.json`);
  // Contains only the public signing message — no secrets.
  writeFileSync(file, JSON.stringify(generated, null, 2), { mode: 0o600 });
  return file;
}

function loadIntent(cid: string): GenerateIntentResponse {
  const file = path.join(INTENTS_DIR, `${cid}.json`);
  if (!existsSync(file)) throw new Error(`Intent ${cid} not found (.state/intents/) — regenerate it.`);
  return JSON.parse(readFileSync(file, "utf8")) as GenerateIntentResponse;
}

export function agentStateFile(): string {
  return path.join(STATE_DIR, "agent.json");
}

export function rememberAgentId(agentId: string): void {
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(agentStateFile(), JSON.stringify({ agent_id: agentId, saved_at: new Date().toISOString() }, null, 2), {
    mode: 0o600,
  });
}

export function resolveAgentId(): string {
  const cfg = treasuryConfig();
  if (cfg.agentId) return cfg.agentId;
  if (existsSync(agentStateFile())) {
    const j = JSON.parse(readFileSync(agentStateFile(), "utf8")) as { agent_id?: string };
    if (j.agent_id) return j.agent_id;
  }
  throw new Error(
    "No AGENT_ID known. Create the agent first: npm run policy:create (the human signs once). " +
      "Or set INTENTS_AGENT_ID in .env.",
  );
}

function printOwnerInstructions(generated: GenerateIntentResponse, file: string): void {
  console.log("\n────────── STEP FOR THE HUMAN (owner signature) ──────────");
  console.log(`Intent id (correlation_id): ${generated.correlation_id}`);
  console.log(`Standard:                   ${generated.intent.standard}`);
  console.log(`Signing wallet:             ${JSON.stringify(generated.signer)}`);
  console.log(`Expires:                    ${generated.expires_at ?? "server-limited"}`);
  console.log(`Intent stored:              ${path.relative(process.cwd(), file)}`);
  console.log("\nMessage to sign (intent.payload, return byte-exactly):");
  console.log(redactJson(generated.intent.payload));
  console.log("\nHow to sign (one of these variants):");
  if (generated.intent.standard === "webauthn") {
    console.log(
      `  A) RECOMMENDED (O3): open the popup page with the plain-text policy preview in the owner's browser:`,
    );
    console.log(
      `     http://localhost:8789/sign?cid=${generated.correlation_id}   (server: npx tsx core/intents/owner-sign-popup-server.ts)`,
    );
    console.log("     Confirm with Touch ID — the page stores signed_data itself. Then submit (below).");
  }
  if (generated.intent.standard === "nep366") {
    console.log(
      "  A) Wallet with NEP-366 support: wallet.signDelegateActions({ delegateActions: [payload] })",
    );
  }
  if (generated.intent.standard === "nep413") {
    console.log(
      "  A) Wallet: wallet.signMessage({ message, recipient, nonce }) — pass the nonce base64-decoded (32 bytes).",
    );
  }
  console.log("  B) You are the owner and use the prepared helper (start it YOURSELF, deliberately):");
  console.log(
    `     npm run owner:sign -- --cid ${generated.correlation_id} --keystore <path/to/credential.json> --i-am-the-owner`,
  );
  console.log("\nThen submit the result file:");
  console.log(
    `  npm run policy:submit -- --cid ${generated.correlation_id} --signed core/intents/.state/intents/${generated.correlation_id}.signed.json`,
  );
  console.log("───────────────────────────────────────────────────────────────");
}

async function generateAndPrint(
  client: IntentsClient,
  body: Record<string, unknown>,
  purpose: string,
): Promise<GenerateIntentResponse> {
  const generated = await client.generateIntent(body, newIdempotencyKey(purpose));
  const file = saveIntent(generated);
  console.log(redactJson({ correlation_id: generated.correlation_id, type: generated.type, preview: generated.preview }));
  printOwnerInstructions(generated, file);
  return generated;
}

/**
 * agent_create: creates the treasury account with the Foreman policy (one click for the human).
 * ownerType "near"    → {type:"near", account_id, public_key} — on-chain key precheck runs.
 * ownerType "passkey" → OwnerWallet.oneOf[2] {type:"passkey", credential_id, public_key(DER P-256),
 *                       rp_id, origin} from .state/passkey.json (registry: popup server /register).
 */
export async function createAgent(
  ownerAccount?: string,
  name?: string,
  ownerPublicKey?: string,
  ownerType: "near" | "passkey" = "near",
): Promise<void> {
  const cfg = treasuryConfig();
  const api = client();
  let ownerWallet: Record<string, unknown>;

  if (ownerType === "passkey") {
    const pkFile = path.join(STATE_DIR, "passkey.json");
    if (!existsSync(pkFile)) {
      throw new Error(
        "No registered passkey (.state/passkey.json). Register first: " +
          "npx tsx core/intents/owner-sign-popup-server.ts → http://localhost:8789/register (Touch ID #1).",
      );
    }
    const pk = JSON.parse(readFileSync(pkFile, "utf8")) as Record<string, string>;
    for (const f of ["credential_id", "public_key", "rp_id", "origin"]) {
      if (!pk[f]) throw new Error(`passkey.json missing field ${f} — repeat registration.`);
    }
    // Exactly the 5 fields of the OwnerWallet passkey schema (additionalProperties:false, openapi clarification 06.11.).
    ownerWallet = {
      type: "passkey",
      credential_id: pk.credential_id,
      public_key: pk.public_key,
      rp_id: pk.rp_id,
      origin: pk.origin,
    };
  } else {
    const owner = ownerAccount ?? cfg.ownerAccount;
    if (!owner) {
      throw new Error(
        "OWNER_ACCOUNT missing. Set .env OWNER_ACCOUNT_MAINNET=<the human's mainnet NEAR account> " +
          "(RULES.md: owner ≠ treasury ≠ contract ≠ swarms) and retry: npm run policy:create",
      );
    }
    const publicKey = ownerPublicKey ?? cfg.ownerPublicKey;
    if (!publicKey) {
      throw new Error(
        "OWNER_PUBLIC_KEY missing (ed25519:…). The API requires the owner's signing key in the agent_create intent. " +
          "Set it in .env or: npm run policy:create -- --owner-public-key ed25519:…",
      );
    }
    ownerWallet = { type: "near", account_id: owner, public_key: publicKey };
  }

  await assertQuotaHeadroom(api, true);
  if (ownerType === "near") await assertOwnerKeyOnChain(cfg, String(ownerWallet.account_id), String(ownerWallet.public_key));
  const policy = buildTreasuryPolicy(cfg);
  console.log("Proposed Foreman treasury policy:");
  console.log(redactJson(policySummary(policy)));
  await generateAndPrint(api, {
    type: "agent_create",
    name: name ?? "foreman-treasury",
    owner: ownerWallet,
    policy,
  }, "agent-create");
}

/**
 * On-chain precheck so the human does NOT sign in vain: NEP-366 delegates are validated
 * by the API against the owner account's access key on MAINNET. If OWNER_PUBLIC_KEY is
 * not an access key on the account (e.g. a Meteor key is still being added), submit fails —
 * we warn before generating and save the signing click.
 */
async function assertOwnerKeyOnChain(
  cfg: ReturnType<typeof treasuryConfig>,
  owner: string,
  publicKey: string,
): Promise<void> {
  if (process.argv.includes("--skip-key-precheck")) {
    console.warn("WARNING: on-chain key precheck skipped via flag.");
    return;
  }
  try {
    const res = await fetch(cfg.nearRpcMainnet, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "foreman-precheck",
        method: "query",
        params: { request_type: "view_access_key_list", account_id: owner, finality: "final" },
      }),
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    const doc = (await res.json()) as { result?: { keys?: Array<{ public_key: string }> }; error?: unknown };
    const keys = (doc.result?.keys ?? []).map((k) => k.public_key);
    if (keys.length === 0) {
      console.warn("Note: no access keys visible on the owner account (RPC view empty) — precheck inconclusive.");
      return;
    }
    if (!keys.includes(publicKey)) {
      throw new Error(
        `OWNER_PUBLIC_KEY is not (yet) an access key of ${owner} on mainnet — the signature would be rejected at submit as owner_signature_invalid/nonce error. ` +
          "Wait until the wallet key shows up in 'near keys' (let the Meteor setup finish) or use --skip-key-precheck deliberately.",
      );
    }
    console.log(`Precheck ok: OWNER_PUBLIC_KEY is an access key of ${owner} (mainnet, ${keys.length} keys total).`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("not (yet) an access key")) throw err;
    console.warn(`Precheck unavailable (RPC error ${String((err as Error)?.name ?? "?")}): continuing — submit validates anyway.`);
  }
}

/** policy_update: reads the revision, rebuilds the policy, expects an owner signature. */
export async function updatePolicy(): Promise<void> {
  const api = client();
  const agentId = resolveAgentId();
  const current = await api.getPolicy(agentId);
  if (!current.policy || current.revision === null) {
    throw new Error("Agent has no APPLIED policy yet — have policy:create signed first.");
  }
  const cfg = treasuryConfig();
  const policy = buildTreasuryPolicy(cfg);
  await generateAndPrint(
    api,
    {
      type: "policy_update",
      agent_id: agentId,
      expected_revision: current.revision,
      policy,
    },
    `policy-update-r${current.revision + 1}`,
  );
}

/** submit: takes the signed_data file created BY THE HUMAN and submits it. */
export async function submitSigned(cid: string, signedFile: string): Promise<void> {
  const api = client();
  const generated = loadIntent(cid);
  if (!existsSync(signedFile)) {
    throw new Error(`signed_data file not found: ${signedFile}`);
  }
  const signedData = JSON.parse(readFileSync(signedFile, "utf8"));
  const status = await api.submitIntent({
    type: generated.type,
    correlation_id: generated.correlation_id,
    signed_data: signedData,
  });
  let current = status;
  for (let i = 0; i < 10; i++) {
    const state = toLifecycleStatus(current.status);
    if (state !== "PENDING") break;
    current = await api.getStatus(cid, { waitMs: 30_000 });
  }
  const final = toLifecycleStatus(current.status);
  console.log(`\nIntent ${cid}: API status=${current.status} → lifecycle=${final}` + (current.failure_code ? ` (${current.failure_code})` : ""));
  if (final === "COMPLETED" && generated.type === "agent_create") {
    const agentId =
      (current as { agent_id?: string | null }).agent_id ??
      extractAgentId(generated) ??
      (await latestAgentId(api));
    if (agentId) {
      rememberAgentId(agentId);
      console.log(`Agent id remembered: ${agentId} → next: npm run quote-demo`);
    }
  }
  if (final === "NEEDS_REVIEW" || final === "UNCERTAIN") {
    console.log("Do not resend — observe the same correlation_id: npm run policy-status -- --cid", cid);
  }
}

function extractAgentId(generated: GenerateIntentResponse): string | undefined {
  const p = generated.preview as { agent_id?: string } | undefined;
  return p?.agent_id ?? undefined;
}

async function latestAgentId(client: IntentsClient): Promise<string | undefined> {
  const list = await client.listAgents().catch(() => null);
  return list?.data?.[0]?.agent_id as string | undefined;
}

function client(): IntentsClient {
  return new IntentsClient(treasuryConfig());
}

// ---------- CLI (runs ONLY on direct start, never when imported by cli/* entrypoints) ----------
function isMainModule(): boolean {
  return process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMainModule()) {
  const [, , cmd, ...rest] = process.argv;
  const arg = (name: string): string | undefined => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };

  if (cmd === "create" || cmd === undefined) {
    const ownerType = (arg("owner-type") === "passkey" ? "passkey" : "near") as "near" | "passkey";
    await createAgent(arg("owner"), arg("name"), arg("owner-public-key"), ownerType);
  } else if (cmd === "update") {
    await updatePolicy();
  } else if (cmd === "submit") {
    const cid = arg("cid");
    const signed = arg("signed");
    if (!cid || !signed) {
      console.error("Usage: tsx core/intents/sign-policy.ts submit --cid <id> --signed <file.json>");
      process.exit(2);
    }
    await submitSigned(cid, signed);
  } else {
    console.error(`Unknown command "${cmd}". Allowed: create | update | submit`);
    process.exit(2);
  }
}
