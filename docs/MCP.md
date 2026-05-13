# Charles MCP server

Charles exposes a read-only [Model Context Protocol](https://modelcontextprotocol.io) server so external clients — Claude Desktop, Cursor, custom agents — can pull workspace state on demand. Founders mint and revoke their own keys. No writes flow in. No tool can mutate a workspace through this endpoint.

## How to connect

The endpoint is `https://<your-app-host>/api/mcp`. Mint a key under **Settings → MCP**, copy it once (we will not show it again), and point your client at the URL with a bearer header.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "charles": {
      "url": "https://app.charles.dev/api/mcp",
      "transport": "streamable_http",
      "headers": { "Authorization": "Bearer chs_..." }
    }
  }
}
```

Restart Claude Desktop. The Charles tools appear in the tool list.

### Cursor

Add to `~/.cursor/mcp.json` or the workspace `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "charles": {
      "url": "https://app.charles.dev/api/mcp",
      "headers": { "Authorization": "Bearer chs_..." }
    }
  }
}
```

### Generic MCP client

Any client that speaks Streamable HTTP MCP works. Send JSON-RPC POSTs to `/api/mcp` with the bearer header. The server is stateless — no SSE, no sessions.

## What's exposed

Ten read-only tools. Every tool is scoped to the workspace the key belongs to; you cannot pass a `spaceId` argument.

| Tool | Returns |
| --- | --- |
| `get_mission` | Mission title, one-line pitch, target customer, stage, description, plus core memory slots. |
| `list_departments` | The six departments and their current autonomy levels. |
| `get_current_stage` | Current stage slug, label, purpose, and gates with completion status. |
| `list_recent_runs` | Last N agent runs (cap 50): department, task, status, duration, started-at. |
| `list_pending_approvals` | Pending drafts and paused runs awaiting founder approval. |
| `list_integrations` | Active third-party integrations. No secrets. |
| `cost_rollup` | Per-day USD cost rollup grouped by department and model (cap 90 days). |
| `audit_feed` | Recent audit events across runs, drafts, approvals, integrations, stages. |
| `recent_drafts` | Last 20 agent drafts, optionally filtered by status. |
| `workspace_health` | One-call snapshot: stage, open gates, pending approvals, last-7-day cost, active integrations. |

If you are wiring a fresh client, start with `workspace_health` — it returns the smallest useful payload to ground further calls.

## Auth

Two paths, same endpoint.

- **API key bearer.** Tokens start with `chs_` followed by 48 hex chars. Send `Authorization: Bearer chs_...`. Hashes are stored server-side; the raw token is shown once at creation.
- **OAuth (MCP discovery).** Clients that follow the MCP OAuth flow can discover the authorization server at `/.well-known/oauth-authorization-server`. The authorize page is `/authorize`; the token endpoint is `/api/mcp/oauth/token`.

## Limits

- Per-IP: 60 requests / minute (pre-auth, brute-force defense).
- Per-workspace: 120 requests / minute (post-auth).
- Per-founder: 10 key generations / hour, 20 keys total per workspace.
- All tools are read-only. There is no escape hatch — Phase 6 does not expose writes through MCP.
- Founders can revoke any key at any time from **Settings → MCP**. Revocation is immediate.
