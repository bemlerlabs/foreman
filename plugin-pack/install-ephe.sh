#!/usr/bin/env bash
# Optional, host-specific: install the Foreman skill pack into an ephe host
# (~/.ephe/plugins/foreman) so it gets three slash commands and a routing skill.
# Usage: ./plugin-pack/install-ephe.sh [path-to-foreman-repo]
# The repo path defaults to this checkout (the parent of plugin-pack).
#
# You do not need this to use Foreman. Every host that speaks MCP gets the same four
# tools from plugin-pack/mcp/foreman_mcp.py (see install.sh), and every agent that can
# run a shell can drive scripts/foreman_flow.py directly. This script only registers the
# ephe-native pack, for people who use that host and want its slash commands.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="${1:-$(cd "$HERE/.." && pwd)}"
DEST="$HOME/.ephe/plugins/foreman"

[[ -f "$REPO/scripts/foreman_flow.py" ]] || { echo "ERROR: $REPO is not a foreman checkout (scripts/foreman_flow.py missing)" >&2; exit 1; }

mkdir -p "$DEST/skills/foreman"
sed "s|{{FOREMAN_REPO}}|$REPO|g" "$HERE/foreman/ephe-plugin.json" > "$DEST/ephe-plugin.json"
sed "s|{{FOREMAN_REPO}}|$REPO|g" "$HERE/foreman/skills/foreman/SKILL.md" > "$DEST/skills/foreman/SKILL.md"
python3 -m json.tool "$DEST/ephe-plugin.json" > /dev/null

echo "installed the ephe-native pack -> $DEST (repo: $REPO)"
echo "the host picks it up on the next turn; verify with its own plugin list."
