#!/usr/bin/env node
// Demo treasury top-up: a plain NEAR transfer, signed locally and broadcast via dRPC send_tx
// (same path as scripts/near_send.cjs, but with a Transfer action instead of a function call).
// usage: node scripts/near_transfer.cjs <from> <to> <nearAmount>
const fs = require('fs');
const path = require('path');
const os = require('os');

const { nearApi, actionCreators } = require('./near_modules.cjs');

const RPC = process.env.RPC_URL || 'https://near-testnet.drpc.org';
let lastTxHash = null;

async function main() {
  const [fromId, toId, nearAmount] = process.argv.slice(2);
  if (!fromId || !toId || !nearAmount) {
    console.error('usage: node near_transfer.cjs <from> <to> <near>');
    process.exit(2);
  }
  const creds = JSON.parse(
    fs.readFileSync(path.join(os.homedir(), '.near-credentials', 'testnet', `${fromId}.json`), 'utf8'),
  );
  const keyStore = new nearApi.keyStores.InMemoryKeyStore();
  await keyStore.setKey('testnet', fromId, creds.private_key);
  const near = await nearApi.connect({ networkId: 'testnet', nodeUrl: RPC, keyStore });
  const account = await near.account(fromId);

  const provider = account.connection.provider;
  const orig = provider.sendJsonRpc.bind(provider);
  provider.sendJsonRpc = async (m, p) => {
    if (m.startsWith('broadcast_tx_')) {
      const r = await orig('send_tx', p);
      lastTxHash = r && r.transaction ? r.transaction.hash : lastTxHash;
      return r;
    }
    return orig(m, p);
  };

  const yocto = nearApi.utils.format.parseNearAmount(String(nearAmount));
  const actions = [actionCreators.transfer(BigInt(yocto))];
  const res = await account.signAndSendTransaction({ receiverId: toId, actions });
  if (res.status && res.status.Failure) {
    console.error('send_tx Failure:', JSON.stringify(res.status.Failure).slice(0, 200));
    console.log('Transaction Id', res.transaction.hash);
    process.exit(3);
  }
  console.log('Transaction Id', res.transaction.hash);
  const st = await provider.query({ request_type: 'view_account', account_id: toId, finality: 'final' });
  console.log('BALANCE', toId, (Number(st.amount) / 1e24).toFixed(3), 'NEAR');
}

main().catch((e) => {
  console.error('near_transfer ERROR:', String((e && e.message) || e).slice(0, 300));
  if (lastTxHash) console.log('Transaction Id', lastTxHash);
  process.exit(1);
});