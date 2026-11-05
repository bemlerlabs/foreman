/**
 * owner-sign-helper.ts — Signier-WERKZEUG für den MENSCHEN, kein Auto-Signing im Produkt.
 *
 * Dieses Skript wird vom Treasury-Code NIEMALS importiert oder aufgerufen. Der Eigentümer
 * startet es bewusst selbst und bestätigt mit --i-am-the-owner, dass er der Owner des
 * OWNER_ACCOUNT ist. Es signiert die gespeicherte Signier-Message eines Intents exakt
 * bytegenau (NEP-413 oder NEP-366) und schreibt <cid>.signed.json zur Übergabe an
 * `npm run policy:submit`.
 *
 * Der Private Key kommt NIE ins Repo: er liegt im Keystore-File des Eigentümers
 * (near-cli-Format {"public_key","private_key"} oder "ed25519:…") und wird nur für den
 * Signiervorgang in den Prozess geladen.
 *
 * Run (vom Eigentümer):
 *   npm run owner:sign -- --cid <correlation_id> --keystore <datei> --i-am-the-owner
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { KeyPair } from "near-api-js";
import { KeyPairEd25519 } from "near-api-js";
import { STATE_DIR, redact } from "./env.js";
import type { GenerateIntentResponse } from "./client.js";

const argv = process.argv.slice(2);
const arg = (n: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const flag = (n: string) => argv.includes(`--${n}`);

if (!flag("i-am-the-owner")) {
  console.error(
    "Abbruch: Dieses Werkzeug signiert Owner-Intents. Es ist ausschließlich für die Person bestimmt,\n" +
      "die OWNER_ACCOUNT besitzt. Bestätige mit --i-am-the-owner, dass DU der Eigentümer bist.",
  );
  process.exit(2);
}

const cidArg = arg("cid");
const keystoreArg = arg("keystore");
if (!cidArg || !keystoreArg) {
  console.error("Benutzung: npm run owner:sign -- --cid <id> --keystore <credential.json> --i-am-the-owner");
  process.exit(2);
}
const cid: string = cidArg;
const keystorePath: string = keystoreArg;

const intentFile = path.join(STATE_DIR, "intents", `${cid}.json`);
let generated: GenerateIntentResponse;
try {
  generated = JSON.parse(readFileSync(intentFile, "utf8"));
} catch {
  console.error(`Intent ${cid} nicht gefunden unter core/intents/.state/intents/`);
  process.exit(1);
}

function loadKeyPair(ksPath: string): KeyPairEd25519 {
  const raw = JSON.parse(readFileSync(ksPath, "utf8")) as { private_key?: string } | string;
  const secret = typeof raw === "string" ? raw : raw.private_key;
  if (!secret || !secret.startsWith("ed25519:")) throw new Error("Keystore enthält keinen ed25519-Secret-Key");
  return KeyPair.fromString(secret as never) as KeyPairEd25519;
}

/** NEP-413 borsh: u32-LE-Len + bytes für message, recipient, nonce — dann sha256, dann ed25519. */
function borshNep413(message: string, recipient: string, nonce: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const pushStr = (s: Uint8Array) => {
    const len = new DataView(new ArrayBuffer(4));
    len.setUint32(0, s.length, true);
    parts.push(new Uint8Array(len.buffer), s);
  };
  pushStr(enc.encode(message));
  pushStr(enc.encode(recipient));
  pushStr(nonce);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function main() {
  const { intent, signer } = generated;
  const keyPair = loadKeyPair(keystorePath);
  const publicKey = keyPair.getPublicKey().toString();
  if (signer.public_key && publicKey !== signer.public_key) {
    throw new Error("owner_account_mismatch: Keystore-Key passt nicht zum erwarteten Signer dieses Intents");
  }

  if (intent.standard === "nep413") {
    const p = intent.payload as { message: string; recipient: string; nonce: string };
    const borsh = borshNep413(p.message, p.recipient, Buffer.from(p.nonce, "base64"));
    const digest = createHash("sha256").update(borsh).digest();
    const signature = Buffer.from(keyPair.sign(new Uint8Array(digest)).signature).toString("base64");
    const signed = { standard: intent.standard, payload: intent.payload, public_key: publicKey, signature };
    writeOut(signed);
    return;
  }

  if (intent.standard === "nep366") {
    const { actions, encodeDelegateAction, encodeSignedDelegate, JsonRpcProvider, Signature } = await import("near-api-js");
    const { treasuryConfig } = await import("./env.js");
    const cfg = treasuryConfig();
    const provider = new JsonRpcProvider({ url: cfg.nearRpcMainnet });
    const access = await provider.viewAccessKey({
      accountId: signer.account_id!,
      publicKey,
      finalityQuery: { finality: "final" },
    });
    const payload = intent.payload as {
      receiverId: string;
      actions: Array<{ params: { methodName: string; args: unknown; gas: string; deposit: string } }>;
    };
    const delegateAction = {
      senderId: signer.account_id!,
      receiverId: payload.receiverId,
      publicKey: keyPair.getPublicKey(),
      nonce: access.nonce + 1n,
      maxBlockHeight: BigInt(access.block_height) + 120n,
      actions: payload.actions.map(({ params }) =>
        (actions as any).functionCall(
          params.methodName,
          Buffer.from(JSON.stringify(params.args)),
          BigInt(params.gas),
          BigInt(params.deposit),
        ),
      ),
    };
    const digest = createHash("sha256").update(encodeDelegateAction(delegateAction as never)).digest();
    const signedDelegate = encodeSignedDelegate({
      delegateAction: delegateAction as never,
      signature: new Signature({ keyType: 0, data: keyPair.sign(new Uint8Array(digest)).signature }),
    });
    const signed = {
      standard: intent.standard,
      payload: intent.payload,
      signed_delegate: Buffer.from(signedDelegate).toString("base64"),
    };
    writeOut(signed);
    return;
  }

  throw new Error(`Standard ${intent.standard} wird vom Helfer nicht unterstützt — nutze dein Wallet.`);
}

function writeOut(signed: unknown): void {
  const outFile = path.join(STATE_DIR, "intents", `${cid}.signed.json`);
  writeFileSync(outFile, JSON.stringify(signed, null, 2), { mode: 0o600 });
  console.log(`Signatur geschrieben: core/intents/.state/intents/${cid}.signed.json`);
  console.log(`Weiter: npm run policy:submit -- --cid ${cid} --signed core/intents/.state/intents/${cid}.signed.json`);
}

try {
  await main();
} catch (err) {
  console.error(`Signieren fehlgeschlagen: ${redact(err instanceof Error ? err.message : String(err))}`);
  process.exit(1);
}
