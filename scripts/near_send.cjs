#!/usr/bin/env node
// phase4.2/T5 hardening (07.11.): signed function call against an RPC that blocks broadcast_*
// (dRPC disables broadcast_tx_commit/async but offers send_tx). near-cli 4 cannot send_tx —
// this script signs locally with the keychain keys (~/.near-credentials/testnet, secrets are
// NEVER logged) and posts base64 via send_tx. Output like near-cli: "Transaction Id <hash>".
//
// usage: node near_send.cjs <signer> <contract> <method> '<json-args>' [depositYocto] [gas]
// env:   RPC_URL (default https://near-testnet.drpc.org), NEAR_CLI_MODULES (optional module dir)
const fs = require('fs');
const path = require('path');
const os = require('os');

const { nearApi, actionCreators } = require('./near_modules.cjs');

let lastTxHash = null; // filled when the send_tx response arrives

async function main() {
  const [signerId, contractId, methodName, argsJson, depositYocto = '0', gas = '100000000000000'] =
    process.argv.slice(2);
  if (!signerId || !contractId || !methodName) {
    console.error('usage: node near_send.cjs <signer> <contract> <method> \'<json-args>\' [depositYocto] [gas]');
    process.exit(2);
  }
  const credFile = path.join(os.homedir(), '.near-credentials', 'testnet', `${signerId}.json`);
  const creds = JSON.parse(fs.readFileSync(credFile, 'utf8')); // private_key stays in memory only
  const rpc = process.env.RPC_URL || 'https://near-testnet.drpc.org';

  const keyStore = new nearApi.keyStores.InMemoryKeyStore();
  await keyStore.setKey('testnet', signerId, creds.private_key);
  const near = await nearApi.connect({ networkId: 'testnet', nodeUrl: rpc, keyStore });
  const account = await near.account(signerId);

  // broadcast_* is disabled at this provider -> map to send_tx. Both methods take identical
  // params=[base64(signedTx)]; send_tx returns the same FinalExecutionOutcome.
  const provider = account.connection.provider;
  const origSendJsonRpc = provider.sendJsonRpc.bind(provider);
  provider.sendJsonRpc = async (rpcMethod, params) => {
    if (rpcMethod.startsWith('broadcast_tx_')) {
      const res = await origSendJsonRpc('send_tx', params);
      lastTxHash = res && res.transaction ? res.transaction.hash : lastTxHash;
      return res;
    }
    return origSendJsonRpc(rpcMethod, params);
  };

  const actions = [
    actionCreators.functionCall(
      methodName,
      argsJson ? JSON.parse(argsJson) : {},
      BigInt(gas),
      BigInt(depositYocto),
    ),
  ];
  const res = await account.signAndSendTransaction({ receiverId: contractId, actions });
  const status = res.status || {};
  if (status.Failure) {
    console.error(`send_tx Failure for ${methodName}: ${JSON.stringify(status.Failure)}`);
    console.log(`Transaction Id ${res.transaction.hash}`);
    process.exit(3);
  }
  console.log(`Transaction Id ${res.transaction.hash}`);
  if (res.receipts_outcome && res.receipts_outcome.length) {
    const last = res.receipts_outcome[res.receipts_outcome.length - 1];
    if (last.outcome && last.outcome.status && last.outcome.status.SuccessValue) {
      console.log(`SuccessValue: ${Buffer.from(last.outcome.status.SuccessValue, 'base64').toString('utf8')}`);
    }
  }
}

main().catch((e) => {
  const msg = e && e.message ? e.message : String(e);
  if (lastTxHash) {
    console.error(`send_tx contract failure for ${lastTxHash}: ${msg}`);
    console.log(`Transaction Id ${lastTxHash}`);
    process.exit(3);
  }
  console.error('near_send ERROR:', msg);
  process.exit(1);
});