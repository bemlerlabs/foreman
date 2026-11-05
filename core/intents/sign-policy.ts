/**
 * Owner-Policy-Flow (Mission Punkt 3): Policy erzeugen → MENSCH signiert → submit → Status.
 *
 * KEIN AUTO-SIGNING in diesem Modul. Es erzeugt die Owner-Intents über
 * POST /v1/generate-intent und gibt die Signier-Message (intent.payload) + exakte
 * Anleitung für den Menschen aus. Signiert wird ausschließlich außerhalb dieses Codes:
 *   - im Wallet des Eigentümers (empfohlen), oder
 *   - vom Eigentümer selbst gestartet mit `npm run owner:sign` (owner-sign-helper.ts,
 *     separate Datei, explizites --i-am-the-owner-Bekenntnis, liest den Key des Eigentümers).
 *
 * NEP-366 (DelegateAction) ist gaslos: Der API-Sponsor reicht die Transaktion ein —
 * Policy-Edits (budget/destinations/timelock/schedule) laufen sogar off-chain (NEP-413,
 * transaction_hash: null). Gas-Kosten für den Eigentümer: 0.
 *
 * Verwendung:
 *   npm run policy:create                          # Agent + Policy anlegen (Owner-Signatur nötig)
 *   npm run policy:update                          # Policy ändern (Revision wird gelesen)
 *   npm run policy:submit -- --cid <cid> --signed <datei.json>
 *   npm run policy-status                          # Revision/Status/Budget-Usage ansehen
 *
 * Persist-before-dispatch: Jeder generierte Intent liegt vor dem ersten Signatur-Schritt
 * unter .state/intents/<cid>.json — ein Abbruch bricht nichts kaputt.
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
  // Enthält nur die öffentliche Signier-Message — keine Secrets.
  writeFileSync(file, JSON.stringify(generated, null, 2), { mode: 0o600 });
  return file;
}

function loadIntent(cid: string): GenerateIntentResponse {
  const file = path.join(INTENTS_DIR, `${cid}.json`);
  if (!existsSync(file)) throw new Error(`Intent ${cid} nicht gefunden (.state/intents/) — neu generieren.`);
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
    "Kein AGENT_ID bekannt. Erst Agent anlegen: npm run policy:create (der Mensch signiert einmal). " +
      "Oder INTENTS_AGENT_ID in .env setzen.",
  );
}

function printOwnerInstructions(generated: GenerateIntentResponse, file: string): void {
  console.log("\n────────── SCHRITT FÜR DEN MENSCHEN (Owner-Signatur) ──────────");
  console.log(`Intent-ID (correlation_id): ${generated.correlation_id}`);
  console.log(`Standard:                   ${generated.intent.standard}`);
  console.log(`Signierender Wallet:          ${JSON.stringify(generated.signer)}`);
  console.log(`Ablauf:                     ${generated.expires_at ?? "serverseitig begrenzt"}`);
  console.log(`Intent gespeichert:          ${path.relative(process.cwd(), file)}`);
  console.log("\nZu signierende Message (intent.payload, bytegenau zurückgeben):");
  console.log(redactJson(generated.intent.payload));
  console.log("\nSo signierst du (eine der Varianten):");
  if (generated.intent.standard === "nep366") {
    console.log(
      "  A) Wallet mit NEP-366-Unterstützung: wallet.signDelegateActions({ delegateActions: [payload] })",
    );
  }
  if (generated.intent.standard === "nep413") {
    console.log(
      "  A) Wallet: wallet.signMessage({ message, recipient, nonce }) — nonce base64-decodiert (32 Bytes) übergeben.",
    );
  }
  console.log("  B) Du bist der Eigentümer und nutzt den vorbereiteten Helfer (bewusst SELBST starten):");
  console.log(
    `     npm run owner:sign -- --cid ${generated.correlation_id} --keystore <pfad/zu/credential.json> --i-am-the-owner`,
  );
  console.log("\nDanach Ergebnis-Datei einreichen:");
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

/** agent_create: legt das Treasury-Konto mit der Foreman-Policy an (ein Klick für den Menschen). */
export async function createAgent(
  ownerAccount?: string,
  name?: string,
  ownerPublicKey?: string,
): Promise<void> {
  const cfg = treasuryConfig();
  const owner = ownerAccount ?? cfg.ownerAccount;
  if (!owner) {
    throw new Error(
      "OWNER_ACCOUNT fehlt. .env OWNER_ACCOUNT=<mainnet NEAR-Konto des Menschen> setzen " +
        "(RULES.md: Owner ≠ Treasury ≠ Contract ≠ Swarms) und erneut: npm run policy:create",
    );
  }
  const publicKey = ownerPublicKey ?? cfg.ownerPublicKey;
  if (!publicKey) {
    throw new Error(
      "OWNER_PUBLIC_KEY fehlt (ed25519:…). Die API verlangt den Signier-Key des Eigentümers im agent_create-Intent. " +
        "Setzen in .env oder: npm run policy:create -- --owner-public-key ed25519:…",
    );
  }
  await assertQuotaHeadroom(client(), true);
  await assertOwnerKeyOnChain(cfg, owner, publicKey);
  const policy = buildTreasuryPolicy(cfg);
  console.log("Vorgeschlagene Foreman-Treasury-Policy:");
  console.log(redactJson(policySummary(policy)));
  await generateAndPrint(client(), {
    type: "agent_create",
    name: name ?? "foreman-treasury",
    owner: { type: "near", account_id: owner, public_key: publicKey },
    policy,
  }, "agent-create");
}

/**
 * Onchain-Vorprüfung, damit der Mensch NICHT umsonst signiert: NEP-366-Delegate werden von
 * der API gegen den Access-Key des Owner-Kontos auf MAINNET validiert. Fehlt OWNER_PUBLIC_KEY
 * als Access-Key auf dem Konto (z.B. Meteor-Key läuft noch ein), schlägt submit fehl — wir
 * warnen vor dem Generieren und sparen den Signier-Klick.
 */
async function assertOwnerKeyOnChain(
  cfg: ReturnType<typeof treasuryConfig>,
  owner: string,
  publicKey: string,
): Promise<void> {
  if (process.argv.includes("--skip-key-precheck")) {
    console.warn("WARNUNG: Onchain-Key-Vorprüfung per Flag übersprungen.");
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
      console.warn("Hinweis: keine Access-Keys auf dem Owner-Konto sichtbar (RPC-Ansicht leer) — Vorprüfung unentschieden.");
      return;
    }
    if (!keys.includes(publicKey)) {
      throw new Error(
        `OWNER_PUBLIC_KEY ist (noch) kein Access-Key von ${owner} auf mainnet — Signatur würde bei submit als owner_signature_invalid/nonce-Fehler abgewiesen. ` +
          "Warte bis der Wallet-Key in 'near keys' auftaucht (Meteor-Einlauf abwarten) oder --skip-key-precheck bewusst nutzen.",
      );
    }
    console.log(`Precheck ok: OWNER_PUBLIC_KEY ist Access-Key von ${owner} (mainnet, ${keys.length} Keys gesamt).`);
  } catch (err) {
    if (err instanceof Error && err.message.includes("kein Access-Key")) throw err;
    console.warn(`Vorprüfung nicht möglich (RPC-Fehler ${String((err as Error)?.name ?? "?")}): fahre fort — submit validiert ohnehin.`);
  }
}

/** policy_update: liest Revision, baut Policy neu, erwartet Owner-Signatur. */
export async function updatePolicy(): Promise<void> {
  const api = client();
  const agentId = resolveAgentId();
  const current = await api.getPolicy(agentId);
  if (!current.policy || current.revision === null) {
    throw new Error("Agent hat noch keine APPLIED-Policy — erst policy:create durchsignieren lassen.");
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

/** submit: nimmt die VOM MENSCHEN erstellte signed_data-Datei und reicht sie ein. */
export async function submitSigned(cid: string, signedFile: string): Promise<void> {
  const api = client();
  const generated = loadIntent(cid);
  if (!existsSync(signedFile)) {
    throw new Error(`signed_data-Datei nicht gefunden: ${signedFile}`);
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
  console.log(`\nIntent ${cid}: API-Status=${current.status} → Lifecycle=${final}` + (current.failure_code ? ` (${current.failure_code})` : ""));
  if (final === "COMPLETED" && generated.type === "agent_create") {
    const agentId =
      (current as { agent_id?: string | null }).agent_id ??
      extractAgentId(generated) ??
      (await latestAgentId(api));
    if (agentId) {
      rememberAgentId(agentId);
      console.log(`Agent-ID gemerkt: ${agentId} → weiter mit: npm run quote-demo`);
    }
  }
  if (final === "NEEDS_REVIEW" || final === "UNCERTAIN") {
    console.log("Nicht erneut senden — gleiches correlation_id beobachten: npm run policy-status -- --cid", cid);
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

// ---------- CLI (läuft NUR bei direktem Start, nie bei import durch cli/*-Entrypoints) ----------
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
    await createAgent(arg("owner"), arg("name"), arg("owner-public-key"));
  } else if (cmd === "update") {
    await updatePolicy();
  } else if (cmd === "submit") {
    const cid = arg("cid");
    const signed = arg("signed");
    if (!cid || !signed) {
      console.error("Benutzung: tsx core/intents/sign-policy.ts submit --cid <id> --signed <datei.json>");
      process.exit(2);
    }
    await submitSigned(cid, signed);
  } else {
    console.error(`Unbekanntes Kommando "${cmd}". Erlaubt: create | update | submit`);
    process.exit(2);
  }
}
