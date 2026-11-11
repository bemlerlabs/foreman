/**
 * owner-sign-popup-server.ts — passkey owner flow (T2, lead decision O3) on a local server.
 *
 * Routes (binds 127.0.0.1, OPEN via http://localhost:8789 — Safari WebAuthn wants the
 * hostname "localhost" rpId, not an IP rpId; localhost is a secure context):
 *   GET  /register        → registration page (Touch ID #1): @simplewebauthn/browser
 *                           startRegistration, rpId "localhost", platform, UV required, ES256(-7).
 *                           COSE P-256 → DER-SPKI base64url (API pattern MFkwEwYHKo…); server checks
 *                           the pattern + stores .state/passkey.json (0600). No secret, public only.
 *   GET  /sign?cid=…      → signing page (Touch ID #2): shows the policy in PLAIN TEXT (mandatory
 *                           screen), startAuthentication(optionsJSON = intent.payload byte-for-byte),
 *                           POST signed_data → .state/intents/<cid>.signed.json (payload is set by the
 *                           server from the ORIGINAL intent, never from the browser).
 *   POST /register-result · POST /submit-signed — receivers.
 *
 * Security: no API key in the browser, no secrets in the page; binds loopback only;
 * the signing message comes exclusively from the locally stored generate-intent file;
 * signed_data UNCHANGED for policy:submit.
 *
 * Run: npx tsx core/intents/owner-sign-popup-server.ts
 */
import http from "node:http";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { STATE_DIR, redact } from "./env.js";

const PORT = Number(process.argv.includes("--port") ? process.argv[process.argv.indexOf("--port") + 1] : 8789);
const RP_ID = "localhost"; // lead specification: Safari WebAuthn + secure context
const ORIGIN = `http://localhost:${PORT}`;
const PASSKEY_FILE = path.join(STATE_DIR, "passkey.json");
const API_PUBKEY_PATTERN = /^MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE[A-Za-z0-9_-]{85}[AQgw]$/;

const b64url = (buf: Uint8Array | Buffer): string =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// Vendored @simplewebauthn/server@13 helpers (esm.sh bundle, pinned; tested on Node 22):
// server-side CBOR/authData parsing — @simplewebauthn/browser@13 itself ships NO cborDecode.
const swa = await import("./vendor/simplewebauthn-helpers.bundle.mjs");

// ---------------- Passkey registration ----------------

let pendingChallenge: string | null = null;

function registrationOptions() {
  pendingChallenge = b64url(randomBytes(32)); // kept server-side and verified at /register-result
  return {
    rp: { id: RP_ID, name: "Foreman — Intents Treasury" },
    user: {
      id: b64url(randomBytes(16)),
      name: "foreman-owner",
      displayName: "Foreman Owner (human)",
    },
    challenge: pendingChallenge,
    pubKeyCredParams: [{ type: "public-key" as const, alg: -7 }], // P-256/ES256 only — API requires the DER pattern
    authenticatorSelection: { authenticatorAttachment: "platform" as const, userVerification: "required" as const },
    timeout: 120_000,
    attestationType: "none" as const,
  };
}

/**
 * RegistrationResponseJSON (from @simplewebauthn/browser startRegistration) → OwnerWallet fields.
 * Verifies clientDataJSON (type/challenge/origin), parses authData→COSE P-256 and exports
 * DER-SPKI base64url — exactly the API pattern ^MFkwEwYHKo…$.
 */
async function extractPasskey(reg: {
  id?: string;
  rawId?: string;
  response?: { clientDataJSON?: string; attestationObject?: string };
}): Promise<{ credential_id: string; public_key: string }> {
  const credential_id = reg?.rawId || reg?.id || "";
  if (!/^[A-Za-z0-9_-]{16,}$/.test(credential_id)) throw new Error("credential_id missing/unexpected (base64url expected)");
  const cd = reg.response?.clientDataJSON;
  const ao = reg.response?.attestationObject;
  if (!cd || !ao) throw new Error("response.clientDataJSON/attestationObject missing");

  const clientData = JSON.parse(Buffer.from(swa.isoBase64URL.toBuffer(cd)).toString("utf8")) as {
    type?: string;
    challenge?: string;
    origin?: string;
  };
  if (clientData.type !== "webauthn.create") throw new Error(`clientDataJSON.type is "${clientData.type}", expected webauthn.create`);
  if (!pendingChallenge || clientData.challenge !== pendingChallenge) throw new Error("challenge mismatch against the issued registration options");
  if (clientData.origin !== ORIGIN) throw new Error(`origin "${clientData.origin}" != ${ORIGIN} — open the page via the stated localhost URL`);
  pendingChallenge = null; // single use

  const att = swa.decodeAttestationObject(swa.isoBase64URL.toBuffer(ao)) as unknown as Map<string, unknown>;
  const authData = new Uint8Array(att.get("authData") as ArrayBuffer | Uint8Array);
  const parsed = swa.parseAuthenticatorData(authData) as unknown as {
    flags?: { at?: boolean };
    credentialID?: Uint8Array;
    credentialPublicKey?: Map<number, Uint8Array | number> | Uint8Array;
    aaguid?: Uint8Array;
  };
  if (!parsed.flags?.at || !parsed.credentialID || !parsed.credentialPublicKey) {
    throw new Error("attestedCredentialData missing (AT flag not set?)");
  }
  if (b64url(parsed.credentialID) !== credential_id) {
    throw new Error("credential_id in authData differs from the response id");
  }
  // parseAuthenticatorData returns credentialPublicKey as re-encoded bytes (for the Ed25519 patch case).
  const cose = (parsed.credentialPublicKey instanceof Uint8Array
    ? (swa.isoCBOR.decodeFirst(parsed.credentialPublicKey) as Map<number, Uint8Array | number>)
    : parsed.credentialPublicKey)!;
  const x = cose.get(-2);
  const y = cose.get(-3);
  if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32 || cose.get(3) !== -7) {
    throw new Error("COSE key is not P-256/ES256 (alg -7) — repeat registration with Touch ID");
  }
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "EC", crv: "P-256", x: b64url(x), y: b64url(y), ext: true },
    { name: "ECDSA", namedCurve: "P-256" },
    true, // extractable: we need exportKey("spki") for the API DER pattern
    ["verify"],
  );
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", key));
  const public_key = b64url(spki);
  if (!API_PUBKEY_PATTERN.test(public_key)) {
    throw new Error(
      `public_key does not satisfy the API DER pattern (91B SPKI, base64url) — AAGUID ${parsed.aaguid ? Buffer.from(parsed.aaguid).toString("hex") : "?"}`,
    );
  }
  return { credential_id, public_key };
}

function readPasskey(): { credential_id: string; public_key: string; rp_id: string; origin: string } | null {
  if (!existsSync(PASSKEY_FILE)) return null;
  try {
    return JSON.parse(readFileSync(PASSKEY_FILE, "utf8"));
  } catch {
    return null;
  }
}

// ---------------- Signing ----------------

function loadIntent(cid: string) {
  const file = path.join(STATE_DIR, "intents", `${cid}.json`);
  if (!existsSync(file)) throw new Error(`Intent ${cid} not found under core/intents/.state/intents/`);
  return JSON.parse(readFileSync(file, "utf8")) as {
    correlation_id: string;
    type: string;
    signer: Record<string, unknown>;
    intent: { standard: string; payload: unknown };
    preview?: Record<string, unknown>;
    expires_at?: string;
  };
}

function policyPreviewText(g: ReturnType<typeof loadIntent>): string {
  const p = (g.preview as { policy?: Record<string, unknown> })?.policy ?? {};
  const budget = (p.budget ?? {}) as Record<string, unknown>;
  const dest = (p.destinations ?? {}) as { mode?: string; list?: unknown[] };
  return [
    (g.preview as { summary?: string })?.summary ?? `${g.type}`,
    `Actions: ${(p.actions as string[] | undefined)?.join(", ") ?? "-"}`,
    `Assets: ${(p.assets as string[] | undefined)?.map((a) => (a.includes("wrap.near") ? "NEAR" : a.includes("17208628") ? "USDC" : a)).join(", ") ?? "-"}`,
    `Budget: daily ${String(budget.daily_usd ?? "-")} USD · weekly ${String(budget.weekly_usd ?? "-")} USD · monthly ${String(budget.monthly_usd ?? null)}`,
    `Timelock: ${String(p.timelock_ms ?? "-")} ms · max_actions_per_hour: ${String(p.max_actions_per_hour ?? "-")}`,
    `Destinations: ${String(dest.mode ?? "-")}${Array.isArray(dest.list) ? ` (${dest.list.length} entries)` : ""}`,
    `Owner approval required: ${String(p.owner_approval)} · Frozen: ${String(p.frozen)}`,
  ].join("\n");
}

// ---------------- Pages ----------------

const BASE_CSS = `body{font-family:-apple-system,sans-serif;background:#0b0e14;color:#e6e6e6;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.card{background:#141a26;border:1px solid #26324a;border-radius:16px;padding:36px;max-width:660px;width:92vw}
h1{font-size:22px;margin:0 0 6px}pre{background:#0b0e14;border:1px solid #26324a;border-radius:10px;padding:14px;font-size:13px;white-space:pre-wrap}
button{background:#f8d245;color:#111;border:0;border-radius:10px;padding:14px 22px;font-size:16px;font-weight:600;cursor:pointer;margin-top:14px}
.warn{color:#f8d245}#status{margin-top:14px;font-family:monospace;font-size:13px;white-space:pre-wrap;color:#9fb0c8}`;

function registerPage(): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Foreman — Register owner passkey</title><style>${BASE_CSS}</style></head><body>
<div class="card"><h1>🔑 Register Foreman owner passkey (Touch ID)</h1>
<p>You are registering your passkey as the owner signing key for the Foreman treasury.
rpId: <b>localhost</b> · P-256/ES256 · platform authenticator (Touch ID). One-time. No secrets, no money.</p>
<button id="go">Touch ID — register passkey</button><div id="status"></div></div>
<script type="module">
const st=document.getElementById('status');
document.getElementById('go').onclick=async()=>{
try{
  st.textContent="Fetching options…";
  const opts=await (await fetch("/register-options")).json();
  st.textContent="Touch ID dialog opened…";
  const {startRegistration}=await import("https://esm.sh/@simplewebauthn/browser@13?bundle");
  const reg=await startRegistration({optionsJSON:opts});
  st.textContent="Server check (challenge/origin/COSE→DER)…";
  const r=await fetch("/register-result",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify(reg)});
  const j=await r.json();
  st.textContent=j.ok?"✅ Passkey registered (credential_id "+(j.credential_id||"").slice(0,12)+"…).\\nNext: npm run policy:create -- --owner-type passkey":"Error: "+j.error;
}catch(e){st.textContent="Error: "+(e?.message||JSON.stringify(e));}};
</script></body></html>`;
}

function signPage(g: ReturnType<typeof loadIntent>): string {
  const policyText = redact(policyPreviewText(g)).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const embedded = redact(JSON.stringify(g));
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Foreman — Owner signature</title><style>${BASE_CSS}</style></head><body>
<div class="card"><h1>🔐 Foreman treasury — review the policy &amp; sign with Touch ID</h1>
<p>You are signing <b>${g.type}</b> (webauthn). Gas: <b>0</b>. Expires: ${g.expires_at ?? "?"}</p>
<p class="warn">READ FIRST — a moment of trust, do not click through:</p>
<pre>${policyText}</pre>
<button id="go">Touch ID — sign policy</button><div id="status"></div></div>
<script>
const INTENT=${embedded};
const st=document.getElementById('status');
document.getElementById('go').onclick=async()=>{
try{
  st.textContent="Touch ID dialog opened…";
  const {startAuthentication}=await import("https://esm.sh/@simplewebauthn/browser@13?bundle");
  const credential=await startAuthentication({optionsJSON:INTENT.intent.payload});
  st.textContent="Signature received — saving…";
  const r=await fetch("/submit-signed?cid="+encodeURIComponent(INTENT.correlation_id),{method:"POST",
    headers:{"content-type":"application/json"},body:JSON.stringify({standard:INTENT.intent.standard,credential})});
  const j=await r.json();
  st.textContent=j.ok?"✅ Signed + saved: "+j.file+"\\nNext: npm run policy:submit -- --cid "+INTENT.correlation_id+" --signed "+j.file:"Error: "+j.error;
}catch(e){st.textContent="Error: "+(e?.message||JSON.stringify(e));}};
</script></body></html>`;
}

// ---------------- Server ----------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", ORIGIN);
  const send = (code: number, type: string, body: string) => {
    res.statusCode = code;
    res.setHeader("content-type", type);
    res.end(body);
  };
  const readBody = async () => {
    let body = "";
    for await (const chunk of req) body += chunk;
    return body;
  };

  if (req.method === "GET" && url.pathname === "/register") return send(200, "text/html; charset=utf-8", registerPage());
  if (req.method === "GET" && url.pathname === "/register-options")
    return send(200, "application/json", JSON.stringify(registrationOptions()));
  if (req.method === "POST" && url.pathname === "/register-result") {
    try {
      const valid = await extractPasskey(JSON.parse(await readBody()));
      const record = { ...valid, rp_id: RP_ID, origin: ORIGIN, registered_at: new Date().toISOString() };
      mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
      writeFileSync(PASSKEY_FILE, JSON.stringify(record, null, 2), { mode: 0o600 });
      console.log(`✅ Passkey registered: credential_id ${record.credential_id.slice(0, 12)}… (${record.rp_id})`);
      return send(200, "application/json", JSON.stringify({ ok: true, credential_id: record.credential_id }));
    } catch (e) {
      return send(400, "application/json", JSON.stringify({ ok: false, error: redact(String((e as Error)?.message ?? e)) }));
    }
  }
  if (req.method === "GET" && url.pathname === "/sign") {
    try {
      return send(200, "text/html; charset=utf-8", signPage(loadIntent(url.searchParams.get("cid") ?? "")));
    } catch (e) {
      return send(404, "text/plain; charset=utf-8", redact(String((e as Error)?.message ?? e)));
    }
  }
  if (req.method === "POST" && url.pathname === "/submit-signed") {
    const cid = url.searchParams.get("cid") ?? "";
    try {
      const g = loadIntent(cid);
      const body = JSON.parse(await readBody());
      if (body?.standard !== g.intent.standard) throw new Error("standard mismatch");
      if (!body?.credential || typeof body.credential !== "object") throw new Error("credential missing");
      // payload byte-for-byte from the ORIGINAL — never from the browser.
      const out = { standard: body.standard, payload: g.intent.payload, credential: body.credential };
      const outFile = path.join(STATE_DIR, "intents", `${cid}.signed.json`);
      mkdirSync(path.dirname(outFile), { recursive: true, mode: 0o700 });
      writeFileSync(outFile, JSON.stringify(out, null, 2), { mode: 0o600 });
      console.log(`✅ signed_data saved: ${outFile}`);
      return send(200, "application/json", JSON.stringify({ ok: true, file: path.relative(process.cwd(), outFile) }));
    } catch (e) {
      return send(400, "application/json", JSON.stringify({ ok: false, error: redact(String((e as Error)?.message ?? e)) }));
    }
  }
  if (req.method === "GET" && url.pathname === "/status") {
    const pk = readPasskey();
    return send(200, "application/json", JSON.stringify({ passkey_registered: !!pk, rp_id: RP_ID, origin: ORIGIN }));
  }
  return send(404, "text/plain", "Unknown route");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Foreman owner popup:  http://localhost:${PORT}/register   (register passkey, Touch ID #1)`);
  console.log(`Signing page:         http://localhost:${PORT}/sign?cid=<correlation_id>   (policy preview + Touch ID #2)`);
  console.log(`IMPORTANT: open http://localhost:${PORT} (NOT 127.0.0.1 — Safari WebAuthn rpId).`);
});
