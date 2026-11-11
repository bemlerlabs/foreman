// Shared near-api-js resolution for the local signing scripts (near_send / near_transfer).
// Order: NEAR_CLI_MODULES env -> locally resolvable near-api-js -> global near-cli install
// (`npm root -g`/near-cli/node_modules). No hardcoded machine paths.
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

function candidateDirs() {
  const dirs = [];
  if (process.env.NEAR_CLI_MODULES) dirs.push(process.env.NEAR_CLI_MODULES);
  try {
    const g = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (g) dirs.push(path.join(g, 'near-cli', 'node_modules'));
  } catch {}
  return dirs;
}

function load() {
  for (const dir of candidateDirs()) {
    const api = path.join(dir, 'near-api-js');
    const tx = path.join(dir, '@near-js/transactions/lib/action_creators.js');
    if (fs.existsSync(api) && fs.existsSync(tx)) {
      return { nearApi: require(api), actionCreators: require(tx).actionCreators };
    }
  }
  // Deps installed next to this repo (plain node resolution).
  return {
    nearApi: require('near-api-js'),
    actionCreators: require('@near-js/transactions/lib/action_creators.js').actionCreators,
  };
}

module.exports = load();