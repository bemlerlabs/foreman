#!/usr/bin/env bash
# Print the Foreman MCP registration for this checkout — the install step for any agent host.
# Usage: ./plugin-pack/install.sh [--probe]
#   default   the mcpServers block, with this repo's absolute path already filled in
#   --probe   also start the server and list the tools it exposes (no network, no keys)
#
# There is nothing to copy into place: the server resolves the repo root from its own location,
# so a checkout is already an installation. Paste the block into whatever file your host reads MCP
# servers from — see plugin-pack/mcp/README.md for the shape and the quick check.
# A host-specific pack (slash commands, skill) is a separate, optional step; see install-ephe.sh.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
SERVER="$HERE/mcp/foreman_mcp.py"

[[ -f "$SERVER" ]] || { echo "ERROR: $SERVER missing — is this a foreman checkout?" >&2; exit 1; }

cat <<EOF
// Foreman as an MCP server — paste into your agent's mcpServers config.
{
  "mcpServers": {
    "foreman": {
      "command": "python3",
      "args": ["$SERVER"]
    }
  }
}
EOF

if [[ "${1:-}" == "--probe" ]]; then
  echo
  echo "probing $SERVER (stdio, no network):"
  printf '%s\n' \
    '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"installer","version":"0"}}}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
    | python3 "$SERVER" \
    | python3 -c '
import json, sys
for line in sys.stdin:
    msg = json.loads(line)
    if msg.get("id") == 1:
        print("  server :", msg["result"]["serverInfo"]["name"], msg["result"]["serverInfo"]["version"])
    elif msg.get("id") == 2:
        for tool in msg["result"]["tools"]:
            print("  tool   :", tool["name"])
'
fi
