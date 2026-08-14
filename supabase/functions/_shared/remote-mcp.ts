import { PayloadTooLargeError, readBoundedJsonBody } from "./bounded-json.ts";
import { exactCorsHeaders, parseExactOriginAllowlist } from "./exact-cors.ts";
import type { RateLimiter } from "./rate-limit.ts";
import {
  attachmentUploadLinkInputSchema,
  attachmentUploadLinkOutputSchema,
  reportIssueInputSchema,
  reportIssueOutputSchema,
  reportResponseSchema,
  toUtcIsoDatetime,
  type ReportIssueInput,
  type ReportResponse,
  type AttachmentUploadLinkInput,
} from "./report-contracts.ts";
import { sha256Hex } from "./sha256.ts";

interface OAuthIdentity {
  provider?: unknown;
  user_id?: unknown;
  provider_id?: unknown;
}

interface VerifiedOAuthUser {
  userId: string;
  isAnonymous: boolean;
  email?: unknown;
  userMetadata?: Record<string, unknown>;
  claims: Record<string, unknown>;
  identities: OAuthIdentity[];
}

export interface McpReporter {
  userId: string;
  provider: "github";
  providerId: string;
  displayName: string;
  email: string | null;
}

interface RemoteMcpDataStore {
  createUploadSession(input: {
    reportId: string;
    reporterId: string;
    tokenHash: string;
    expiresAt: string;
  }): Promise<{ reportId: string; expiresAt: string }>;
  hasActiveMembership(reporter: McpReporter): Promise<boolean>;
  insertReport(report: ReportIssueInput, reporter: McpReporter): Promise<ReportResponse>;
}

interface SupabaseClientLike {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): unknown;
    };
    insert(rows: Record<string, unknown>[]): {
      select(columns: string): {
        single(): PromiseLike<{
          data: {
            id: string;
            public_number: number;
            status: string;
            created_at: string;
          } | null;
          error: unknown;
        }>;
      };
    };
  };
  rpc(name: string, input: Record<string, unknown>): {
    single(): PromiseLike<{ data: Record<string, unknown> | null; error: unknown }>;
  };
}

interface MembershipQuery {
  eq(column: string, value: unknown): MembershipQuery;
  maybeSingle(): PromiseLike<{ data: { user_id: string } | null; error: unknown }>;
}

interface RemoteMcpOptions {
  resourceUrl: string;
  authorizationServer: string;
  allowedOrigins: string;
  verifyAccessToken(token: string): Promise<VerifiedOAuthUser | null>;
  hasActiveMembership(reporter: McpReporter): Promise<boolean>;
  rateLimiter: RateLimiter;
  handleMcp(request: Request, reporter: McpReporter): Promise<Response>;
  maxBodyBytes?: number;
}

interface RemoteReportIssueOptions {
  reporter: McpReporter;
  rateLimiter: RateLimiter;
  store: Pick<RemoteMcpDataStore, "insertReport">;
}

interface RemoteAttachmentUploadLinkOptions {
  reporter: McpReporter;
  uploadPageUrl: string;
  rateLimiter: RateLimiter;
  store: Pick<RemoteMcpDataStore, "createUploadSession">;
  now?: () => Date;
  randomBytes?: (length: number) => Uint8Array;
}

function json(body: unknown, status: number, headers: Headers) {
  return Response.json(body, { status, headers });
}

function metadataHeaders() {
  return new Headers({
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "cache-control": "no-store",
  });
}

function challenge(headers: Headers, metadataUrl: string, error: string, description: string) {
  headers.set(
    "www-authenticate",
    `Bearer error="${error}", error_description="${description}", resource_metadata="${metadataUrl}"`,
  );
}

function bearerToken(request: Request) {
  const match = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "");
  return match?.[1] ?? null;
}

function audienceIncludes(audience: unknown, resourceUrl: string) {
  return audience === resourceUrl ||
    (Array.isArray(audience) && audience.length > 0 && audience.every((item) => typeof item === "string") &&
      audience.includes(resourceUrl));
}

function githubReporter(user: VerifiedOAuthUser): McpReporter | null {
  if (user.isAnonymous || !user.userId) return null;
  const identity = user.identities.find(
    (candidate) =>
      candidate.provider === "github" &&
      candidate.user_id === user.userId &&
      typeof candidate.provider_id === "string" &&
      candidate.provider_id.trim(),
  );
  if (!identity || typeof identity.provider_id !== "string") return null;

  const providerId = identity.provider_id.trim();
  const metadata = user.userMetadata ?? {};
  const displayName = [metadata.name, metadata.user_name]
    .find((value) => typeof value === "string" && value.trim()) as string | undefined;
  const email = typeof user.email === "string" && user.email.trim() ? user.email.trim() : null;

  return {
    userId: user.userId,
    provider: "github",
    providerId,
    displayName: displayName?.trim() ?? `GitHub user ${providerId}`,
    email,
  };
}

function withCors(response: Response, cors: Headers) {
  const headers = new Headers(response.headers);
  for (const [name, value] of cors) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export function createRemoteReportIssueHandler({
  reporter,
  rateLimiter,
  store,
}: RemoteReportIssueOptions) {
  return async (input: unknown) => {
    const report = reportIssueInputSchema.parse(input);
    const rateLimit = await rateLimiter.consume("mcp:report", reporter.userId, 60, 60);
    if (!rateLimit.allowed) throw new Error("Report submission is rate limited.");

    const saved = await store.insertReport(report, reporter);
    const structuredContent = reportIssueOutputSchema.parse(saved);
    return {
      content: [
        {
          type: "text" as const,
          text: `Issue ${saved.publicId} was submitted with status ${saved.status}.`,
        },
      ],
      structuredContent,
    };
  };
}

function capabilityToken(randomBytes: (length: number) => Uint8Array) {
  const bytes = randomBytes(32);
  if (bytes.byteLength !== 32) throw new Error("Upload capability entropy is unavailable.");
  const encoded = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `pb_upload_${encoded}`;
}

export function createRemoteAttachmentUploadLinkHandler({
  reporter,
  uploadPageUrl,
  rateLimiter,
  store,
  now = () => new Date(),
  randomBytes = (length) => crypto.getRandomValues(new Uint8Array(length)),
}: RemoteAttachmentUploadLinkOptions) {
  return async (input: AttachmentUploadLinkInput) => {
    const { reportId } = attachmentUploadLinkInputSchema.parse(input);
    const rateLimit = await rateLimiter.consume("mcp:upload-link", reporter.userId, 10, 3_600);
    if (!rateLimit.allowed) throw new Error("Upload link creation is rate limited.");

    const capability = capabilityToken(randomBytes);
    const requestedExpiry = new Date(now().getTime() + 30 * 60_000).toISOString();
    const session = await store.createUploadSession({
      reportId,
      reporterId: reporter.userId,
      tokenHash: await sha256Hex(capability),
      expiresAt: requestedExpiry,
    });
    const url = new URL(uploadPageUrl);
    url.hash = capability;
    const structuredContent = attachmentUploadLinkOutputSchema.parse({
      reportId: session.reportId,
      uploadUrl: url.href,
      expiresAt: session.expiresAt,
      maxFiles: 5,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: `Open this private link to attach files to ${session.reportId}: ${url.href}`,
        },
      ],
      structuredContent,
    };
  };
}

export function createRemoteMcpDataStore(supabase: SupabaseClientLike): RemoteMcpDataStore {
  return {
    async createUploadSession(input) {
      const publicNumber = input.reportId.slice(3);
      const { data, error } = await supabase.rpc("create_report_upload_session", {
        p_report_public_number: publicNumber,
        p_reporter_user_id: input.reporterId,
        p_token_hash_hex: input.tokenHash,
        p_expires_at: input.expiresAt,
      }).single();
      if (
        error ||
        typeof data?.report_public_id !== "string" ||
        typeof data?.expires_at !== "string"
      ) {
        throw new Error("Unable to create an upload session.");
      }
      return { reportId: data.report_public_id, expiresAt: data.expires_at };
    },

    async hasActiveMembership(reporter) {
      const query = supabase.from("beta_profiles").select("user_id") as MembershipQuery;
      const { data, error } = await query
        .eq("user_id", reporter.userId)
        .eq("provider", reporter.provider)
        .eq("provider_id", reporter.providerId)
        .eq("status", "active")
        .maybeSingle();
      if (error) throw new Error("Unable to verify beta membership.");
      return data?.user_id === reporter.userId;
    },

    async insertReport(report, reporter) {
      const { data, error } = await supabase
        .from("reports")
        .insert([
          {
            title: report.title,
            description: report.description,
            expected_behavior: report.expectedBehavior,
            reproduction_steps: report.reproductionSteps,
            severity: report.severity,
            type: report.type,
            platform: report.platform,
            app_version: report.appVersion,
            reporter_display_name: reporter.displayName,
            reporter_email: reporter.email,
            reporter_user_id: reporter.userId,
            reporter_provider: reporter.provider,
            reporter_provider_id: reporter.providerId,
          },
        ])
        .select("id, public_number, status, created_at")
        .single();
      if (error || !data) throw new Error("Unable to persist the report.");
      return reportResponseSchema.parse({
        id: data.id,
        publicId: `PB-${data.public_number}`,
        status: data.status,
        submittedAt: toUtcIsoDatetime(data.created_at),
      });
    },
  };
}

export function createRemoteMcpHttpHandler({
  resourceUrl,
  authorizationServer,
  allowedOrigins,
  verifyAccessToken,
  hasActiveMembership,
  rateLimiter,
  handleMcp,
  maxBodyBytes = 65_536,
}: RemoteMcpOptions) {
  const metadataUrl = `${resourceUrl}/.well-known/oauth-protected-resource`;
  const allowedOriginSet = parseExactOriginAllowlist(allowedOrigins);

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.href === metadataUrl || url.pathname.endsWith("/project-builder-mcp/.well-known/oauth-protected-resource")) {
      const headers = metadataHeaders();
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
      if (!["GET", "HEAD"].includes(request.method)) {
        headers.set("allow", "GET, HEAD, OPTIONS");
        return json({ error: "method_not_allowed" }, 405, headers);
      }
      if (request.method === "HEAD") return new Response(null, { status: 200, headers });
      return json(
        {
          resource: resourceUrl,
          authorization_servers: [authorizationServer],
          resource_name: "Project Builder Feedback MCP",
        },
        200,
        headers,
      );
    }

    const origin = request.headers.get("origin");
    const headers = exactCorsHeaders(origin, allowedOriginSet ?? new Set(), "POST, OPTIONS");
    if (!allowedOriginSet) {
      return json({ error: "server_error", error_description: "MCP is unavailable." }, 503, headers);
    }
    if (origin && !allowedOriginSet.has(origin)) {
      return json({ error: "origin_forbidden", error_description: "Origin is not allowed." }, 403, headers);
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") {
      headers.set("allow", "POST, OPTIONS");
      return json({ error: "method_not_allowed" }, 405, headers);
    }

    const token = bearerToken(request);
    if (!token) {
      challenge(headers, metadataUrl, "invalid_token", "Authentication is required.");
      return json(
        { error: "invalid_token", error_description: "Authentication is required." },
        401,
        headers,
      );
    }

    let user: VerifiedOAuthUser | null;
    try {
      user = await verifyAccessToken(token);
    } catch {
      user = null;
    }
    const clientId = user?.claims.client_id;
    if (
      !user ||
      !audienceIncludes(user.claims.aud, resourceUrl) ||
      typeof clientId !== "string" ||
      !clientId.trim()
    ) {
      challenge(headers, metadataUrl, "invalid_token", "The access token is invalid.");
      return json(
        { error: "invalid_token", error_description: "The access token is invalid." },
        401,
        headers,
      );
    }

    const reporter = githubReporter(user);
    if (!reporter) {
      challenge(headers, metadataUrl, "insufficient_scope", "Active GitHub beta membership is required.");
      return json(
        {
          error: "insufficient_scope",
          error_description: "Active GitHub beta membership is required.",
        },
        403,
        headers,
      );
    }

    let rateLimit;
    try {
      rateLimit = await rateLimiter.consume("mcp:http", reporter.userId, 120, 60);
    } catch {
      return json({ error: "server_error", error_description: "MCP is unavailable." }, 503, headers);
    }
    if (!rateLimit.allowed) {
      headers.set("retry-after", String(Math.max(1, rateLimit.retryAfterSeconds)));
      return json({ error: "rate_limited", error_description: "Too many requests." }, 429, headers);
    }

    let active: boolean;
    try {
      active = await hasActiveMembership(reporter);
    } catch {
      return json({ error: "server_error", error_description: "MCP is unavailable." }, 503, headers);
    }
    if (!active) {
      challenge(headers, metadataUrl, "insufficient_scope", "Active GitHub beta membership is required.");
      return json(
        {
          error: "insufficient_scope",
          error_description: "Active GitHub beta membership is required.",
        },
        403,
        headers,
      );
    }

    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.startsWith("application/json")) {
      return json({ error: "unsupported_media_type" }, 415, headers);
    }
    const accepted = (request.headers.get("accept") ?? "").toLowerCase();
    if (!accepted.includes("application/json") || !accepted.includes("text/event-stream")) {
      return json({ error: "not_acceptable" }, 406, headers);
    }

    let body: unknown;
    try {
      body = await readBoundedJsonBody(request, maxBodyBytes);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        return json({ error: "payload_too_large" }, 413, headers);
      }
      return json({ error: "invalid_request" }, 400, headers);
    }

    const forwardedHeaders = new Headers(request.headers);
    forwardedHeaders.delete("content-length");
    const forwarded = new Request(request.url, {
      method: "POST",
      headers: forwardedHeaders,
      body: JSON.stringify(body),
    });

    try {
      return withCors(await handleMcp(forwarded, reporter), headers);
    } catch {
      return json({ error: "server_error", error_description: "MCP is unavailable." }, 500, headers);
    }
  };
}
