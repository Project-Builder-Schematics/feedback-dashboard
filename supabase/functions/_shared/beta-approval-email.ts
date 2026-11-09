export function betaApprovalEmail(mcpUrl: string) {
  return {
    subject: "Your Project Builder beta access is ready",
    html: `<p>Your beta access is active. Connect the Project Builder feedback MCP with the GitHub account you applied with.</p>
<h2>MCP server URL</h2>
<p><code>${mcpUrl}</code></p>
<h2>Connect from Codex</h2>
<pre><code>codex mcp add project-builder-feedback --url ${mcpUrl}
codex mcp login project-builder-feedback</code></pre>
<p>Finish the browser sign-in with your approved GitHub account. Restart Codex if the tools do not appear.</p>
<h2>Connect from Claude Code</h2>
<pre><code>claude mcp add --transport http project-builder-feedback ${mcpUrl}</code></pre>
<p>Run <code>/mcp</code> in Claude Code, select <code>project-builder-feedback</code>, and sign in with your approved GitHub account.</p>
<h2>Send feedback</h2>
<p>Ask your MCP client to use the <code>report_issue</code> tool. Include what happened and what you expected, the steps to reproduce it, your Project Builder version and operating system, and whether it blocks your work. To attach images or videos, ask the client for an attachment upload link.</p>
<h2>If something fails</h2>
<ul>
<li>Access denied: sign in again with the same GitHub account you applied with.</li>
<li>Wrong account: clear the server's saved authentication and repeat the sign-in.</li>
<li>Tools missing: restart the MCP client.</li>
<li>Upload link expired: ask the client for a new one.</li>
</ul>
<p>Do not share this email, OAuth links, access tokens, or upload links.</p>`,
  };
}
