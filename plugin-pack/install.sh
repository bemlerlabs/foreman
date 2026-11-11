#!/usr/bin/env bash
# Installs the foreman plugin into Ephe (~/.ephe/plugins/foreman).
# Usage: ./plugin-pack/install.sh [path-to-foreman-repo]
# The repo path defaults to this checkout (the parent of plugin-pack).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="${1:-$(cd "$HERE/.." && pwd)}"
DEST="$HOME/.ephe/plugins/foreman"

[[ -f "$REPO/scripts/foreman_flow.py" ]] || { echo "ERROR: $REPO is not a foreman checkout (scripts/foreman_flow.py missing)" >&2; exit 1; }

mkdir -p "$DEST/skills/foreman"
sed "s|{{FOREMAN_REPO}}|$REPO|g" "$HERE/foreman/ephe-plugin.json" > "$DEST/ephe-plugin.json"
sed "s|{{FOREMAN_REPO}}|$REPO|g" "$HERE/foreman/skills/foreman/SKILL.md" > "$DEST/skills/foreman/SKILL.md"
python3 -m json.tool "$DEST/ephe-plugin.json" > /dev/null

echo "installed foreman plugin -> $DEST (repo: $REPO)"
echo "Ephe picks it up on the next turn; verify with 'ephe plugin list' or GET /api/plugins."