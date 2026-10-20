# DoggyNote local MCP connector

The connector works with local MCP clients that launch a stdio command. The desktop app may be closed; the connector talks to your DoggyNote server. Node 22.18 or newer and the checked-out repository are required; Node 24 is recommended.

1. In the repository, run `pnpm install`.
2. Sign in to DoggyNote and open **Account → Agent connections**.
3. Name the connection, choose **Read only** or **Read and propose changes**, and select its boards. Nested boards inherit the selected scope. Your Inbox is available only when selected; other personal boards are available when selected or underneath a selected board.
4. Create the connection and copy its token. The token appears once and expires after 90 days. Store it in the MCP client's environment/secret settings; never commit it or use your login password/session token.
5. Add a stdio server configuration to the MCP client, replacing the paths and token:

```json
{
  "mcpServers": {
    "doggynote": {
      "command": "/absolute/path/to/node",
      "args": ["--experimental-strip-types", "/absolute/path/to/DoggyNote/apps/mcp/src/index.ts"],
      "env": {
        "DOGGYNOTE_URL": "https://notepad.dog",
        "DOGGYNOTE_TOKEN": "<connection token>"
      }
    }
  }
}
```

Use the configuration format supported by your MCP client. The executable and environment values above are the connector's complete setup contract. A local development server may use `http://localhost:8787`; other servers require HTTPS.

The tools are `list_boards`, `read_board`, `propose_board`, `propose_changes`, and `proposal_status`. A board read includes revisions and a pagination cursor. A proposal supports notes/markdown, todo lists, columns, links, nested boards, connectors, comments, layout changes, trash/restore, and reuse of existing scoped image/file asset IDs. Uploading new image/file bytes is not part of this version.

Agent changes stay pending until you open **Agent proposals** on the affected board. Inspect the proposed layout and individual changes, then approve or reject. Proposals apply atomically through normal synchronization. An object edited since the proposal was prepared causes a conflict instead of an overwrite; ask the agent to read the latest board and stage a fresh proposal. Reuse the exact same idempotency key and request when retrying an interrupted request.

Applied proposals can be reversed while their affected objects have no newer meaningful edits or new dependent content. Automatic measured-height changes are allowed. Revoking a connection immediately stops the agent's access and prevents pending proposals from being approved. You can still reverse previously applied proposals when you can edit the affected boards and they remain within the original connection's scope. Password recovery, password change and signing out every device also revoke agent credentials.

The connector cannot approve proposals, permanently purge objects, change sharing, or administer accounts. Tokens never authorize ordinary sync endpoints. Every read/proposal/approval intersects token scope with the user's current permissions.

The real SDK client check used by E2E tests is `apps/mcp/src/client-smoke.ts`. With `DOGGYNOTE_URL`, `DOGGYNOTE_TOKEN`, and `DOGGYNOTE_SMOKE_BOARD` set, running it through Node stages a small reviewable layout and verifies tool discovery, reads, proposal status, and idempotent retry. It prints only the proposal result, never the token.
