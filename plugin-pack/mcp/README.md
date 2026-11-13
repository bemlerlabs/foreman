# Foreman as a portable plugin (MCP)

`foreman_mcp.py` makes Foreman a plugin in **any coding agent that supports the
[Model Context Protocol](https://modelcontextprotocol.io)** — the open standard for
connecting agents to tools. It speaks JSON-RPC 2.0 over stdio using only the Python
standard library: no third-party package, no network install, no registration.

Agents that do not support MCP can still drive Foreman through the same CLI directly
(`python3 scripts/foreman_flow.py <phase>`). The plugin is a convenience, not a lock-in.

## Register the server

The server resolves the repo root from its own location, so it runs straight from a
checkout — nothing to install. Point your agent's MCP config at it. The standard
`mcpServers` shape (replace `<REPO>` with the absolute path of your foreman checkout):

```json
{
  "mcpServers": {
    "foreman": {
      "command": "python3",
      "args": ["<REPO>/plugin-pack/mcp/foreman_mcp.py"]
    }
  }
}
```

Most MCP-capable agents read this from a global or per-project MCP settings file;
consult your agent's MCP documentation for the exact location. After a reload the
agent lists four Foreman tools.

## Tools

| Tool | Args | What it does |
|------|------|--------------|
| `foreman_board` | `job_id` (int) | Read-only bid board: bids, the single counter-offer + reason, receipt hashes, payout tx. Live against `escrow.foreman-team.testnet`; **no keys needed**. |
| `foreman_status` | — | Current job card via the CLI. |
| `foreman_phase` | `phase`, `background?` | Run one workflow phase (`post`, `bids`, `middle`, `acceptdemo`, `finish`, `dashboard`, `recipe`, `all`). |
| `foreman_wait` | `phase` | Collect a detached (`background: true`) phase and return its real output. |

Every tool echoes **real CLI / contract output** — transaction ids, hashes, errors.
Nothing is synthesised. Long phases (`bids`, `finish`) outlive a single tool call:
run them with `background: true`, then collect with `foreman_wait`.

## The workflow (unchanged dogma)

`post` → `bids` → `middle` (exactly **one** reasoned counter-offer, 10% under the best
bid) → `acceptdemo` (fail-closed: accept without a receipt must panic `NOT_DELIVERED`)
→ `finish` (signed receipt, accept, 90/10 payout) → `recipe`.

Read-only tools (`foreman_board`, `foreman_status`) need no keys. Write phases
(`post`, `finish`) need the operator's testnet keys/env, and the host's own
tool-approval gate still applies — the server runs the same CLI a human would and
bypasses nothing.

## Quick check (no agent required)

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"foreman_board","arguments":{"job_id":50}}}' \
  | python3 plugin-pack/mcp/foreman_mcp.py
```

The third response carries the live job-50 board (state `Accepted`, 810.00 NEAR-cent
payout, reputation 78→79, the on-chain receipt hash and payout transaction).