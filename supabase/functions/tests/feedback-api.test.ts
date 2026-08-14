import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";

import {
  createFeedbackApiHandler,
  createSupabaseReportStore,
} from "../_shared/feedback-api.ts";

const validPayload = {
  title: "Project generation hangs",
  description: "The command stops responding after the first prompt.",
  expectedBehavior: "The command should finish successfully.",
  reproductionSteps: ["Run the generator", "Accept the default template", "Wait 60 seconds"],
  severity: "High",
  type: "Bug",
  platform: "macOS 15",
  appVersion: "0.14.2-beta.3",
  reporterDisplayName: "Taylor",
  reporterEmail: "taylor@example.com",
} as const;

function allowingRateLimiter(onConsume?: () => void) {
  return {
    async consume() {
      onConsume?.();
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

async function withServer(
  handler: ReturnType<typeof createFeedbackApiHandler>,
  run: (baseUrl: string) => Promise<void>,
) {
  const server = createServer((request, response) => {
    toRequest(request).then(handler).then(
      async (result) => {
        response.statusCode = result.status;
        for (const [name, value] of result.headers.entries()) {
          response.setHeader(name, value);
        }
        response.end(await result.text());
      },
      (error) => {
        response.statusCode = 500;
        response.end(String(error));
      },
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address == null || typeof address === "string") {
    throw new Error("Expected an ephemeral TCP address.");
  }

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function toRequest(request: Parameters<typeof createServer>[0] extends (
  incoming: infer Incoming,
  response: unknown,
) => unknown
  ? Incoming
  : never) {
  const bodyChunks: Uint8Array[] = [];

  for await (const chunk of request) {
    bodyChunks.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
  }

  return new Request(`http://127.0.0.1${request.url ?? "/"}`, {
    method: request.method,
    headers: new Headers(
      Object.entries(request.headers).flatMap(([name, value]) =>
        Array.isArray(value) ? value.map((entry) => [name, entry]) : value == null ? [] : [[name, value]],
      ),
    ),
    body: bodyChunks.length > 0 ? Buffer.concat(bodyChunks) : undefined,
  });
}

test("rejects unauthenticated report submissions", async () => {
  let rateLimitCalls = 0;
  const handler = createFeedbackApiHandler({
    betaToken: "beta-token",
    rateLimiter: allowingRateLimiter(() => {
      rateLimitCalls += 1;
    }),
    reportStore: {
      async insert() {
        throw new Error("should not be called");
      },
    },
  });

  await withServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/reports`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(validPayload),
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: {
        code: "unauthorized",
        message: "Authorization is required.",
      },
    });
    assert.equal(rateLimitCalls, 0);
  });
});

test("allows configured browser origins and handles their preflight", async () => {
  const handler = createFeedbackApiHandler({
    betaToken: "beta-token",
    rateLimiter: allowingRateLimiter(),
    allowedOrigins: ["https://feedback.example.com"],
    reportStore: {
      async insert() {
        return {
          id: "5f52c35f-8334-46b6-ac4d-8f0e52c8d5d9",
          publicId: "PB-142",
          status: "Pending" as const,
          submittedAt: "2026-08-14T07:20:00.000Z",
        };
      },
    },
  });

  await withServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/reports`, {
      method: "OPTIONS",
      headers: {
        origin: "https://feedback.example.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "authorization, content-type",
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "https://feedback.example.com");
    assert.equal(response.headers.get("access-control-allow-methods"), "POST, GET, OPTIONS");
    assert.match(response.headers.get("access-control-allow-headers") ?? "", /authorization/);
    assert.match(response.headers.get("access-control-allow-headers") ?? "", /apikey/);
    assert.match(response.headers.get("access-control-allow-headers") ?? "", /x-client-info/);
    assert.equal(response.headers.get("vary"), "Origin");

    const submission = await fetch(`${baseUrl}/v1/reports`, {
      method: "POST",
      headers: {
        authorization: "Bearer beta-token",
        "content-type": "application/json",
        origin: "https://feedback.example.com",
      },
      body: JSON.stringify(validPayload),
    });

    assert.equal(submission.status, 201);
    assert.equal(
      submission.headers.get("access-control-allow-origin"),
      "https://feedback.example.com",
    );
  });
});

test("rejects browser origins outside the configured allowlist", async () => {
  const handler = createFeedbackApiHandler({
    betaToken: "beta-token",
    rateLimiter: allowingRateLimiter(),
    allowedOrigins: ["https://feedback.example.com"],
    reportStore: {
      async insert() {
        throw new Error("should not be called");
      },
    },
  });

  await withServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/reports`, {
      method: "OPTIONS",
      headers: {
        origin: "https://attacker.example",
        "access-control-request-method": "POST",
      },
    });

    assert.equal(response.status, 403);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });
});

test("inserts the report through Supabase and returns the public identifier", async () => {
  const recorded: Record<string, unknown>[] = [];
  const store = createSupabaseReportStore({
    from(table) {
      assert.equal(table, "reports");
      return {
        insert(rows: Record<string, unknown>[]) {
          recorded.push(...rows);
          return {
            select() {
              return {
                single: async () => ({
                  data: {
                    id: "5f52c35f-8334-46b6-ac4d-8f0e52c8d5d9",
                    public_number: 142,
                    status: "Pending",
                    created_at: "2026-08-14T07:20:00.000Z",
                  },
                  error: null,
                }),
              };
            },
          };
        },
      };
    },
  });

  const result = await store.insert(validPayload);

  assert.equal(recorded.length, 1);
  assert.deepEqual(recorded[0], {
    title: validPayload.title,
    description: validPayload.description,
    expected_behavior: validPayload.expectedBehavior,
    reproduction_steps: [...validPayload.reproductionSteps],
    severity: validPayload.severity,
    type: validPayload.type,
    platform: validPayload.platform,
    app_version: validPayload.appVersion,
    reporter_display_name: validPayload.reporterDisplayName,
    reporter_email: validPayload.reporterEmail,
  });
  assert.deepEqual(result, {
    id: "5f52c35f-8334-46b6-ac4d-8f0e52c8d5d9",
    publicId: "PB-142",
    status: "Pending",
    submittedAt: "2026-08-14T07:20:00.000Z",
  });
});

test("returns a safe error when persistence fails", async () => {
  const handler = createFeedbackApiHandler({
    betaToken: "beta-token",
    rateLimiter: allowingRateLimiter(),
    reportStore: {
      async insert() {
        throw new Error("database timeout");
      },
    },
  });

  await withServer(handler, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/v1/reports`, {
      method: "POST",
      headers: {
        authorization: "Bearer beta-token",
        "content-type": "application/json",
      },
      body: JSON.stringify(validPayload),
    });

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: {
        code: "service_unavailable",
        message: "Report submission is temporarily unavailable.",
      },
    });
  });
});

test("consumes the beta credential bucket before accepting a submission", async () => {
  const calls: unknown[] = [];
  const handler = createFeedbackApiHandler({
    betaToken: "beta-token",
    rateLimiter: {
      async consume(namespace, subject, limit, windowSeconds) {
        calls.push({ namespace, subject, limit, windowSeconds });
        return { allowed: true, retryAfterSeconds: 0 };
      },
    },
    reportStore: {
      async insert() {
        return {
          id: "5f52c35f-8334-46b6-ac4d-8f0e52c8d5d9",
          publicId: "PB-142",
          status: "Pending" as const,
          submittedAt: "2026-08-14T07:20:00.000Z",
        };
      },
    },
  });

  const response = await handler(
    new Request("https://example.test/v1/reports", {
      method: "POST",
      headers: { authorization: "Bearer beta-token", "content-type": "application/json" },
      body: JSON.stringify(validPayload),
    }),
  );

  assert.equal(response.status, 201);
  assert.deepEqual(calls, [
    {
      namespace: "feedback:submit",
      subject: "beta-token",
      limit: 60,
      windowSeconds: 60,
    },
  ]);
});

test("returns 429 with Retry-After before parsing or storing a limited submission", async () => {
  let stored = false;
  const handler = createFeedbackApiHandler({
    betaToken: "beta-token",
    rateLimiter: {
      async consume() {
        return { allowed: false, retryAfterSeconds: 17 };
      },
    },
    reportStore: {
      async insert() {
        stored = true;
        throw new Error("should not be called");
      },
    },
  });

  const response = await handler(
    new Request("https://example.test/v1/reports", {
      method: "POST",
      headers: { authorization: "Bearer beta-token", "content-type": "application/json" },
      body: "not-json",
    }),
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "17");
  assert.equal(stored, false);
  assert.deepEqual(await response.json(), {
    error: { code: "rate_limited", message: "Too many requests." },
  });
});

test("fails closed with a safe 503 when feedback rate limiting is unavailable", async () => {
  let stored = false;
  const handler = createFeedbackApiHandler({
    betaToken: "beta-token",
    rateLimiter: {
      async consume() {
        throw new Error("secret database details");
      },
    },
    reportStore: {
      async insert() {
        stored = true;
        throw new Error("should not be called");
      },
    },
  });

  const response = await handler(
    new Request("https://example.test/v1/reports", {
      method: "POST",
      headers: { authorization: "Bearer beta-token", "content-type": "application/json" },
      body: JSON.stringify(validPayload),
    }),
  );

  assert.equal(response.status, 503);
  assert.equal(stored, false);
  assert.deepEqual(await response.json(), {
    error: {
      code: "service_unavailable",
      message: "Report submission is temporarily unavailable.",
    },
  });
});

test("rejects oversized report bodies before JSON parsing or storage", async () => {
  let stored = false;
  const handler = createFeedbackApiHandler({
    betaToken: "beta-token",
    rateLimiter: allowingRateLimiter(),
    reportStore: {
      async insert() {
        stored = true;
        throw new Error("should not be called");
      },
    },
  });
  const headers = {
    authorization: "Bearer beta-token",
    "content-type": "application/json",
  };
  const requests = [
    new Request("https://example.test/v1/reports", {
      method: "POST",
      headers: { ...headers, "content-length": "65537" },
      body: "not-json",
    }),
    new Request("https://example.test/v1/reports", {
      method: "POST",
      headers,
      body: "x".repeat(65_537),
    }),
  ];

  for (const request of requests) {
    const response = await handler(request);
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), {
      error: { code: "payload_too_large", message: "Request body is too large." },
    });
  }
  assert.equal(stored, false);
});
