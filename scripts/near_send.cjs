#!/usr/bin/env node
// phase4.2/T5-Härtung (07.11.): Signierter Function-Call gegen ein RPC, das broadcast_* blockiert
// (dRPC deaktiviert broadcast_tx_commit/async, bietet aber send_tx). near-cli 4 kann kein send_tx —
// dieses Skript signiert lokal mit den Keychain-Keys (~/.near-credentials/testnet, Secrets werden
// NIEMALS geloggt) und postet base64 via send_tx. Ausgabe wie near-cli: "Transaction Id <hash>".
//
// usage: node near_send.js <signer> <contract> <method> '<json-args>' [depositYocto] [gas]
// env:   RPC_URL (default https://near-testnet.drpc.org)
const fs = require('fs');
const path = require('path');
const os = require('os');

const CLI_MODULES = '/Users/sanji/.hermes/node-22.23.4/lib/node_modules/near-cli/node_modules';
const nearApi = require(path.join(CLI_MODULES, 'near-api-js'));
const { actionCreators } = require(path.join(
  CLI_MODULES,
  '@near-js/transactions/lib/action_creators.js',
));

let lastTxHash = null; // wird beim send_tx-Antwortfang befüllt

async function main() {
  const [signerId, contractId, methodName, argsJson, depositYocto = '0', gas = '100000000000000'] =
    process.argv.slice(2);
  if (!signerId || !contractId || !methodName) {
    console.error('usage: node near_send.js <signer> <contract> <method> \'<json-args>\' [depositYocto] [gas]');
    process.exit(2);
  }
  const credFile = path.join(os.homedir(), '.near-credentials', 'testnet', `${signerId}.json`);
  const creds = JSON.parse(fs.readFileSync(credFile, 'utf8')); // private_key bleibt rein im Speicher
  const rpc = process.env.RPC_URL || 'https://near-testnet.drpc.org';

  const keyStore = new nearApi.keyStores.InMemoryKeyStore();
  await keyStore.setKey('testnet', signerId, creds.private_key);
  const near = await nearApi.connect({ networkId: 'testnet', nodeUrl: rpc, keyStore });
  const account = await near.account(signerId);

  // broadcast_* ist bei diesem Provider deaktiviert -> auf send_tx mappen. Beide Methoden
  // nehmen identisch params=[base64(signedTx)]; send_tx liefert dasselbe FinalExecutionOutcome.
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
    console.error(`send_tx Contract-Failure für ${lastTxHash}: ${msg}`);
    console.log(`Transaction Id ${lastTxHash}`);
    process.exit(3);
  }
  console.error('near_send FEHLER:', msg);
  process.exit(1);
});
