import assert from "node:assert/strict";
import test from "node:test";

import { betaApprovalEmail } from "../_shared/beta-approval-email.ts";

const mcpUrl = "https://example.supabase.co/functions/v1/project-builder-mcp";

test("approval email carries the MCP URL and the client connection commands", () => {
  const { subject, html } = betaApprovalEmail(mcpUrl);

  assert.equal(subject, "Your Project Builder beta access is ready");
  assert.match(html, new RegExp(`<code>${mcpUrl}</code>`));
  assert.match(html, new RegExp(`codex mcp add project-builder-feedback --url ${mcpUrl}`));
  assert.match(html, /codex mcp login project-builder-feedback/);
  assert.match(html, new RegExp(`claude mcp add --transport http project-builder-feedback ${mcpUrl}`));
  assert.match(html, /report_issue/);
});
