import assert from "node:assert/strict";
import test from "node:test";

import {
  createRemoteAttachmentUploadLinkHandler,
  createRemoteMcpDataStore,
  createRemoteMcpHttpHandler,
  createRemoteReportIssueHandler,
} from "../_shared/remote-mcp.ts";

const resourceUrl =
  "https://bbivrybsyxpmkstomccd.supabase.co/functions/v1/project-builder-mcp";
const metadataUrl = `${resourceUrl}/.well-known/oauth-protected-resource`;
const authorizationServer = "https://bbivrybsyxpmkstomccd.supabase.co/auth/v1";
const allowedOrigin = "https://project-builder-schematics.github.io";
const userId = "a59e96b4-51a4-4da9-9f28-19c807d7b785";

function verifiedUser(overrides: Record<string, unknown> = {}) {
  return {
    userId,
    isAnonymous: false,
    email: "tester@example.com",
    userMetadata: { user_name: "octotester", name: "Octo Tester" },
    claims: { aud: resourceUrl, client_id: "codex-client" },
    identities: [
      {
        provider: "github",
        user_id: userId,
        provider_id: "12345678",
      },
    ],
    ...overrides,
  };
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    resourceUrl,
    authorizationServer,
    allowedOrigins: allowedOrigin,
    verifyAccessToken: async () => verifiedUser(),
    hasActiveMembership: async () => true,
    rateLimiter: {
      async consume() {
        return { allowed: true, retryAfterSeconds: 0 };
      },
    },
    handleMcp: async () => Response.json({ jsonrpc: "2.0", id: 1, result: {} }),
    ...overrides,
  };
}

function mcpRequest(headers: Record<string, string> = {}, body: unknown = { jsonrpc: "2.0" }) {
  return new Request(resourceUrl, {
    method: "POST",
    headers: {
      authorization: "Bearer valid-token",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test("serves protected-resource metadata without authentication", async () => {
  const handler = createRemoteMcpHttpHandler(options());

  const response = await handler(new Request(metadataUrl));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(await response.json(), {
    resource: resourceUrl,
    authorization_servers: [authorizationServer],
    resource_name: "Project Builder Feedback MCP",
  });
  assert.equal((await handler(new Request(metadataUrl, { method: "HEAD" }))).status, 200);
  assert.equal((await handler(new Request(metadataUrl, { method: "OPTIONS" }))).status, 204);
});

test("returns an RFC 9728 challenge before protected work", async () => {
  let verified = false;
  let transported = false;
  const handler = createRemoteMcpHttpHandler(
    options({
      verifyAccessToken: async () => {
        verified = true;
        return null;
      },
      handleMcp: async () => {
        transported = true;
        return new Response();
      },
    }),
  );

  const response = await handler(mcpRequest({ authorization: "" }));

  assert.equal(response.status, 401);
  assert.match(response.headers.get("www-authenticate") ?? "", /Bearer error="invalid_token"/);
  assert.match(
    response.headers.get("www-authenticate") ?? "",
    new RegExp(`resource_metadata="${metadataUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(verified, false);
  assert.equal(transported, false);
});

test("requires a resource-bound OAuth token and exact GitHub identity", async () => {
  for (const [user, expectedStatus] of [
    [verifiedUser({ claims: { aud: "authenticated", client_id: "codex-client" } }), 401],
    [verifiedUser({ claims: { aud: resourceUrl } }), 401],
    [verifiedUser({ isAnonymous: true }), 403],
    [verifiedUser({ identities: [] }), 403],
    [
      verifiedUser({
        identities: [{ provider: "github", user_id: crypto.randomUUID(), provider_id: "1" }],
      }),
      403,
    ],
  ]) {
    let membershipChecked = false;
    const handler = createRemoteMcpHttpHandler(
      options({
        verifyAccessToken: async () => user as ReturnType<typeof verifiedUser>,
        hasActiveMembership: async () => {
          membershipChecked = true;
          return true;
        },
      }),
    );

    const response = await handler(mcpRequest());
    assert.equal(response.status, expectedStatus);
    assert.equal(membershipChecked, false);
  }
});

test("uses one generic forbidden response for inactive beta membership", async () => {
  const handler = createRemoteMcpHttpHandler(
    options({
      hasActiveMembership: async () => false,
    }),
  );

  const response = await handler(mcpRequest());

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "insufficient_scope",
    error_description: "Active GitHub beta membership is required.",
  });
});

test("rate limits before reading the MCP body and forwards verified reporter identity", async () => {
  const calls: unknown[] = [];
  const handler = createRemoteMcpHttpHandler(
    options({
      rateLimiter: {
        async consume(...input: unknown[]) {
          calls.push(input);
          return { allowed: true, retryAfterSeconds: 0 };
        },
      },
      handleMcp: async (request: Request, reporter: unknown) => {
        calls.push(reporter, await request.json());
        return Response.json({ jsonrpc: "2.0", id: 1, result: {} });
      },
    }),
  );

  const response = await handler(mcpRequest({ origin: allowedOrigin }, { jsonrpc: "2.0", id: 1 }));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigin);
  assert.deepEqual(calls[0], ["mcp:http", userId, 120, 60]);
  assert.deepEqual(calls[1], {
    userId,
    provider: "github",
    providerId: "12345678",
    displayName: "Octo Tester",
    email: "tester@example.com",
  });
  assert.deepEqual(calls[2], { jsonrpc: "2.0", id: 1 });
});

test("rejects incompatible headers and oversized streamed JSON", async () => {
  const handler = createRemoteMcpHttpHandler(options());

  assert.equal((await handler(mcpRequest({ "content-type": "text/plain" }))).status, 415);
  assert.equal((await handler(mcpRequest({ accept: "application/json" }))).status, 406);

  const oversized = mcpRequest({}, { value: "x".repeat(70_000) });
  assert.equal((await handler(oversized)).status, 413);
});

test("persists only authenticated reporter provenance after a per-tool rate limit", async () => {
  const calls: unknown[] = [];
  const reporter = {
    userId,
    provider: "github" as const,
    providerId: "12345678",
    displayName: "Octo Tester",
    email: null,
  };
  const handler = createRemoteReportIssueHandler({
    reporter,
    rateLimiter: {
      async consume(...input: unknown[]) {
        calls.push(input);
        return { allowed: true, retryAfterSeconds: 0 };
      },
    },
    store: {
      async insertReport(report: unknown, identity: unknown) {
        calls.push(report, identity);
        return {
          id: "8e0b6c53-e681-4c65-aa2d-3e0b3fd1bbf7",
          publicId: "PB-42",
          status: "Pending" as const,
          submittedAt: "2026-08-14T10:00:00.000Z",
        };
      },
    },
  });

  const output = await handler({
    title: "Broken generation",
    description: "Generation fails after confirming the prompt.",
    expectedBehavior: "The project should be generated.",
    reproductionSteps: ["Open Project Builder", "Generate a project"],
    severity: "High",
    type: "Bug",
    platform: "Codex",
    appVersion: "0.1.0",
  });

  assert.deepEqual(calls[0], ["mcp:report", userId, 60, 60]);
  assert.deepEqual(calls[2], reporter);
  assert.deepEqual(output.structuredContent, {
    publicId: "PB-42",
    status: "Pending",
    submittedAt: "2026-08-14T10:00:00.000Z",
  });
});

test("creates a report-scoped upload link while storing only the capability hash", async () => {
  const calls: unknown[] = [];
  const reporter = {
    userId,
    provider: "github" as const,
    providerId: "12345678",
    displayName: "Octo Tester",
    email: null,
  };
  const handler = createRemoteAttachmentUploadLinkHandler({
    reporter,
    uploadPageUrl:
      "https://project-builder-schematics.github.io/feedback-dashboard/?mode=upload",
    now: () => new Date("2026-08-14T07:20:00.000Z"),
    randomBytes: (length) => {
      assert.equal(length, 32);
      return new Uint8Array(length);
    },
    rateLimiter: {
      async consume(...input: unknown[]) {
        calls.push(input);
        return { allowed: true, retryAfterSeconds: 0 };
      },
    },
    store: {
      async createUploadSession(input: unknown) {
        calls.push(input);
        return { reportId: "PB-42", expiresAt: "2026-08-14T20:50:00.123456+13:00" };
      },
    },
  });

  const output = await handler({ reportId: "PB-42" });

  assert.deepEqual(calls[0], ["mcp:upload-link", userId, 10, 3_600]);
  const stored = calls[1] as Record<string, unknown>;
  assert.equal(stored.reportId, "PB-42");
  assert.equal(stored.reporterId, userId);
  assert.match(String(stored.tokenHash), /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(stored), /pb_upload_/);
  assert.deepEqual(output.structuredContent, {
    reportId: "PB-42",
    uploadUrl:
      `https://project-builder-schematics.github.io/feedback-dashboard/?mode=upload#pb_upload_${"A".repeat(43)}`,
    expiresAt: "2026-08-14T07:50:00.123Z",
    maxFiles: 5,
  });
});

test("queries active membership and inserts report attribution through the admin client", async () => {
  const calls: unknown[] = [];
  const store = createRemoteMcpDataStore({
    rpc(name: string, input: Record<string, unknown>) {
      calls.push(["rpc", name, input]);
      return {
        async single() {
          return {
            data: {
              report_public_id: "PB-42",
              expires_at: "2026-08-14T07:50:00.000Z",
            },
            error: null,
          };
        },
      };
    },
    from(table: string) {
      if (table === "beta_profiles") {
        const filters: unknown[] = [];
        const query = {
          eq(column: string, value: unknown) {
            filters.push([column, value]);
            return query;
          },
          async maybeSingle() {
            calls.push([table, filters]);
            return { data: { user_id: userId }, error: null };
          },
        };
        return {
          select(columns: string) {
            calls.push([table, columns]);
            return query;
          },
        };
      }
      return {
        insert(rows: Record<string, unknown>[]) {
          calls.push([table, rows]);
          return {
            select(columns: string) {
              calls.push([table, columns]);
              return {
                async single() {
                  return {
                    data: {
                      id: "8e0b6c53-e681-4c65-aa2d-3e0b3fd1bbf7",
                      public_number: 42,
                      status: "Pending",
                      created_at: "2026-08-14T10:00:00.123456+13:00",
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  });
  const reporter = {
    userId,
    provider: "github" as const,
    providerId: "12345678",
    displayName: "Octo Tester",
    email: null,
  };

  assert.equal(await store.hasActiveMembership(reporter), true);
  const report = await store.insertReport(
    {
      title: "Broken generation",
      description: "Generation fails.",
      expectedBehavior: "Generation succeeds.",
      reproductionSteps: ["Generate"],
      severity: "High",
      type: "Bug",
      platform: "Codex",
      appVersion: "0.1.0",
    },
    reporter,
  );

  assert.equal(report.publicId, "PB-42");
  assert.equal(report.submittedAt, "2026-08-13T21:00:00.123Z");
  assert.deepEqual(calls[1], [
    "beta_profiles",
    [
      ["user_id", userId],
      ["provider", "github"],
      ["provider_id", "12345678"],
      ["status", "active"],
    ],
  ]);
  const inserted = (calls[2] as [string, Record<string, unknown>[]])[1][0];
  assert.deepEqual(
    {
      reporter_user_id: inserted.reporter_user_id,
      reporter_provider: inserted.reporter_provider,
      reporter_provider_id: inserted.reporter_provider_id,
      reporter_display_name: inserted.reporter_display_name,
      reporter_email: inserted.reporter_email,
    },
    {
      reporter_user_id: userId,
      reporter_provider: "github",
      reporter_provider_id: "12345678",
      reporter_display_name: "Octo Tester",
      reporter_email: null,
    },
  );

  assert.deepEqual(
    await store.createUploadSession({
      reportId: "PB-42",
      reporterId: userId,
      tokenHash: "a".repeat(64),
      expiresAt: "2026-08-14T07:50:00.000Z",
    }),
    { reportId: "PB-42", expiresAt: "2026-08-14T07:50:00.000Z" },
  );
  assert.deepEqual(calls.at(-1), [
    "rpc",
    "create_report_upload_session",
    {
      p_report_public_number: "42",
      p_reporter_user_id: userId,
      p_token_hash_hex: "a".repeat(64),
      p_expires_at: "2026-08-14T07:50:00.000Z",
    },
  ]);
});
