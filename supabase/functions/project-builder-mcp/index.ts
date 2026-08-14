import { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/web-standard-streamable-http";
import { createClient } from "@supabase/supabase-js";

import {
  createRemoteAttachmentUploadLinkHandler,
  createRemoteMcpDataStore,
  createRemoteMcpHttpHandler,
  createRemoteReportIssueHandler,
} from "../_shared/remote-mcp.ts";
import { createSupabaseRateLimiter } from "../_shared/rate-limit.ts";
import { verifiedGithubIdentity } from "../_shared/verified-github-identity.ts";
import {
  attachmentUploadLinkInputSchema,
  attachmentUploadLinkOutputSchema,
  reportIssueInputSchema,
  reportIssueOutputSchema,
} from "../_shared/report-contracts.ts";

function requiredEnvironmentVariable(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function jwtClaims(token: string) {
  const payload = token.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replaceAll("-", "+").replaceAll("_", "/").padEnd(
      Math.ceil(payload.length / 4) * 4,
      "=",
    );
    const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes));
    return claims && typeof claims === "object" ? claims as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const supabaseUrl = requiredEnvironmentVariable("SUPABASE_URL").replace(/\/$/, "");
const secretKeys = JSON.parse(requiredEnvironmentVariable("SUPABASE_SECRET_KEYS")) as Record<
  string,
  string
>;
const secretKey = secretKeys.default;
if (!secretKey) throw new Error("SUPABASE_SECRET_KEYS must include the default key.");

const resourceUrl = `${supabaseUrl}/functions/v1/project-builder-mcp`;
const supabase = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const rateLimiter = createSupabaseRateLimiter(supabase);
const store = createRemoteMcpDataStore(supabase);
const uploadPageUrl = requiredEnvironmentVariable("PB_UPLOAD_PAGE_URL");

const fetchHandler = createRemoteMcpHttpHandler({
  resourceUrl,
  authorizationServer: `${supabaseUrl}/auth/v1`,
  allowedOrigins: requiredEnvironmentVariable("PB_ALLOWED_ORIGINS"),
  rateLimiter,
  async verifyAccessToken(token) {
    const claims = jwtClaims(token);
    if (!claims) return null;
    const { data, error } = await supabase.auth.getUser(token);
    const user = data.user;
    if (error || !user) return null;
    return {
      userId: user.id,
      isAnonymous: user.is_anonymous === true,
      email: user.email,
      userMetadata: user.user_metadata,
      claims,
      identities: (user.identities ?? []).flatMap((identity) => {
        const verified = verifiedGithubIdentity(identity);
        return verified ? [verified] : [];
      }),
    };
  },
  hasActiveMembership: (reporter) => store.hasActiveMembership(reporter),
  async handleMcp(request, reporter) {
    const server = new McpServer({
      name: "project-builder-feedback",
      version: "0.1.0",
    });
    server.registerTool(
      "report_issue",
      {
        title: "Report a Project Builder issue",
        description: "Submit a bug or improvement report from a Project Builder beta test.",
        inputSchema: reportIssueInputSchema,
        outputSchema: reportIssueOutputSchema,
      },
      createRemoteReportIssueHandler({ reporter, rateLimiter, store }),
    );
    server.registerTool(
      "create_attachment_upload_link",
      {
        title: "Create an attachment upload link",
        description:
          "Create a temporary private browser link for attaching images or videos to a submitted report.",
        inputSchema: attachmentUploadLinkInputSchema,
        outputSchema: attachmentUploadLinkOutputSchema,
      },
      createRemoteAttachmentUploadLinkHandler({
        reporter,
        uploadPageUrl,
        rateLimiter,
        store,
      }),
    );
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
});

export default { fetch: fetchHandler };
