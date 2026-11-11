/**
 * owner-sign-helper.ts — signing TOOL for the HUMAN, no auto-signing in the product.
 *
 * This script is NEVER imported or called by treasury code. The owner starts it
 * deliberately and confirms with --i-am-the-owner that they own OWNER_ACCOUNT. It signs
 * the stored signing message of an intent byte-exactly (NEP-413 or NEP-366) and writes
 * <cid>.signed.json for hand-off to `npm run policy:submit`.
 *
 * The private key NEVER enters the repo: it lives in the owner's keystore file
 * (near-cli format {"public_key","private_key"} or "ed25519:…") and is loaded into the
 * process only for the signing step.
 *
 * Run (by the owner):
 *   npm run owner:sign -- --cid <correlation_id> --keystore <file> --i-am-the-owner
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
    "Aborting: this tool signs owner intents. It is intended exclusively for the person who\n" +
      "owns OWNER_ACCOUNT. Confirm with --i-am-the-owner that YOU are the owner.",
  );
  process.exit(2);
}

const cidArg = arg("cid");
const keystoreArg = arg("keystore");
if (!cidArg || !keystoreArg) {
  console.error("Usage: npm run owner:sign -- --cid <id> --keystore <credential.json> --i-am-the-owner");
  process.exit(2);
}
const cid: string = cidArg;
const keystorePath: string = keystoreArg;

const intentFile = path.join(STATE_DIR, "intents", `${cid}.json`);
let generated: GenerateIntentResponse;
try {
  generated = JSON.parse(readFileSync(intentFile, "utf8"));
} catch {
  console.error(`Intent ${cid} not found under core/intents/.state/intents/`);
  process.exit(1);
}

function loadKeyPair(ksPath: string): KeyPairEd25519 {
  const raw = JSON.parse(readFileSync(ksPath, "utf8")) as { private_key?: string } | string;
  const secret = typeof raw === "string" ? raw : raw.private_key;
  if (!secret || !secret.startsWith("ed25519:")) throw new Error("Keystore contains no ed25519 secret key");
  return KeyPair.fromString(secret as never) as KeyPairEd25519;
}

/** NEP-413 borsh: u32-LE length + bytes for message, recipient, nonce — then sha256, then ed25519. */
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
    throw new Error("owner_account_mismatch: keystore key does not match the expected signer of this intent");
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

  throw new Error(`Standard ${intent.standard} is not supported by this helper — use your wallet.`);
}

function writeOut(signed: unknown): void {
  const outFile = path.join(STATE_DIR, "intents", `${cid}.signed.json`);
  writeFileSync(outFile, JSON.stringify(signed, null, 2), { mode: 0o600 });
  console.log(`Signature written: core/intents/.state/intents/${cid}.signed.json`);
  console.log(`Next: npm run policy:submit -- --cid ${cid} --signed core/intents/.state/intents/${cid}.signed.json`);
}

try {
  await main();
} catch (err) {
  console.error(`Signing failed: ${redact(err instanceof Error ? err.message : String(err))}`);
  process.exit(1);
}
