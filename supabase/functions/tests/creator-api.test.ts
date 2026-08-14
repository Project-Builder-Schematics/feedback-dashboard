import assert from "node:assert/strict";
import test from "node:test";

import {
  CREATOR_REPORT_COLUMNS,
  createCreatorApiHandler,
  createSupabaseCreatorReportStore,
} from "../_shared/creator-api.ts";

const creatorId = "8d53279c-0b9f-4d85-a342-208bf48727f8";
const otherUserId = "150b7ee0-e3d9-4d41-8d3b-33aeb3cf5d71";
const reportId = "5f52c35f-8334-46b6-ac4d-8f0e52c8d5d9";
const allowedOrigin = "https://project-builder-schematics.github.io";

const reportRow = {
  id: reportId,
  public_number: 142,
  title: "Project generation hangs",
  reporter_display_name: "Taylor",
  reporter_email: "taylor@example.com",
  status: "Pending",
  severity: "High",
  platform: "macOS 15",
  app_version: "0.14.2-beta.3",
  type: "Bug",
  description: "The command stops responding after the first prompt.",
  expected_behavior: "The command should finish successfully.",
  reproduction_steps: ["Run the generator", "Wait 60 seconds"],
  discard_reason: null,
  created_at: "2026-08-14T07:20:00.000Z",
  updated_at: "2026-08-14T07:20:00.000Z",
};

function allowingRateLimiter(onConsume?: (...input: unknown[]) => void) {
  return {
    async consume(...input: unknown[]) {
      onConsume?.(...input);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

function request(method: string, body?: unknown, origin = allowedOrigin) {
  return new Request("https://example.supabase.co/functions/v1/creator-api", {
    method,
    headers: {
      origin,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function handlerOptions(overrides: Record<string, unknown> = {}) {
  return {
    creatorUserIds: creatorId,
    allowedOrigins: allowedOrigin,
    authenticate: async () => ({
      actorId: creatorId,
      rateLimiter: allowingRateLimiter(),
      store: {
        async createBetaInvite() {
          return { expiresAt: "2026-08-15T07:20:00.000Z" };
        },
        async list() {
          return [reportRow];
        },
        async updateStatus() {
          return { ...reportRow, status: "Resolved" };
        },
      },
    }),
    requestId: () => "420cae56-26fb-4f45-9491-5b7766d6d5a7",
    ...overrides,
  };
}

test("fails closed for empty or malformed creator allowlists", async () => {
  for (const creatorUserIds of ["", "not-a-uuid", `${creatorId},not-a-uuid`]) {
    let authenticated = false;
    const handler = createCreatorApiHandler(
      handlerOptions({
        creatorUserIds,
        authenticate: async () => {
          authenticated = true;
          throw new Error("should not authenticate");
        },
      }),
    );

    const response = await handler(request("GET"));

    assert.equal(response.status, 503);
    assert.equal(authenticated, false);
    assert.deepEqual(await response.json(), {
      error: { code: "service_unavailable", message: "Creator API is unavailable." },
    });
  }
});

test("rejects a valid non-allowlisted user before any database call", async () => {
  let databaseCalled = false;
  let rateLimitCalled = false;
  const handler = createCreatorApiHandler(
    handlerOptions({
      authenticate: async () => ({
        actorId: otherUserId,
        rateLimiter: allowingRateLimiter(() => {
          rateLimitCalled = true;
        }),
        store: {
          async list() {
            databaseCalled = true;
            return [];
          },
          async updateStatus() {
            databaseCalled = true;
            return reportRow;
          },
        },
      }),
    }),
  );

  const response = await handler(request("GET"));

  assert.equal(response.status, 403);
  assert.equal(databaseCalled, false);
  assert.equal(rateLimitCalled, false);
});

test("returns an allowlisted creator's bounded report list with exact CORS and no-store", async () => {
  const handler = createCreatorApiHandler(handlerOptions());
  const response = await handler(request("GET"));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), allowedOrigin);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    reports: [{ ...reportRow, publicId: "PB-142" }],
  });
});

test("rejects origins outside the exact CORS allowlist without authenticating", async () => {
  let authenticated = false;
  const handler = createCreatorApiHandler(
    handlerOptions({
      authenticate: async () => {
        authenticated = true;
        throw new Error("should not authenticate");
      },
    }),
  );

  const response = await handler(request("OPTIONS", undefined, "https://attacker.example"));

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.equal(authenticated, false);
});

test("lists explicit columns in newest-first order with a hard bound", async () => {
  const calls: unknown[] = [];
  const store = createSupabaseCreatorReportStore({
    from(table: string) {
      calls.push(["from", table]);
      return {
        select(columns: string) {
          calls.push(["select", columns]);
          return {
            order(column: string, options: unknown) {
              calls.push(["order", column, options]);
              return {
                async limit(value: number) {
                  calls.push(["limit", value]);
                  return { data: [reportRow], error: null };
                },
              };
            },
          };
        },
      };
    },
    rpc() {
      throw new Error("should not update");
    },
  });

  const result = await store.list();

  assert.deepEqual(calls, [
    ["from", "reports"],
    ["select", CREATOR_REPORT_COLUMNS],
    ["order", "created_at", { ascending: false }],
    ["limit", 100],
  ]);
  assert.equal(result[0]?.publicId, "PB-142");
});

test("strictly rejects invalid status updates without writing an audit event", async () => {
  const invalidBodies = [
    { reportId: "not-a-uuid", status: "Resolved" },
    { reportId, status: "Closed" },
    { reportId, status: "Resolved", actorId: creatorId },
    { reportId, status: "Discarded" },
    { reportId, status: "Discarded", discardReason: "x".repeat(501) },
  ];

  for (const body of invalidBodies) {
    let writes = 0;
    const handler = createCreatorApiHandler(
      handlerOptions({
        authenticate: async () => ({
          actorId: creatorId,
          rateLimiter: allowingRateLimiter(),
          store: {
            async list() {
              return [];
            },
            async updateStatus() {
              writes += 1;
              return reportRow;
            },
          },
        }),
      }),
    );

    const response = await handler(request("PATCH", body));
    assert.equal(response.status, 400);
    assert.equal(writes, 0);
  }
});

test("rejects an oversized request before JSON parsing", async () => {
  let writes = 0;
  const handler = createCreatorApiHandler(
    handlerOptions({
      maxBodyBytes: 128,
      authenticate: async () => ({
        actorId: creatorId,
        rateLimiter: allowingRateLimiter(),
        store: {
          async list() {
            return [];
          },
          async updateStatus() {
            writes += 1;
            return reportRow;
          },
        },
      }),
    }),
  );

  const response = await handler(
    request("PATCH", { reportId, status: "Discarded", discardReason: "x".repeat(500) }),
  );

  assert.equal(response.status, 413);
  assert.equal(writes, 0);
});

test("updates status through one atomic RPC and clears irrelevant discard reasons", async () => {
  const rpcCalls: unknown[] = [];
  const store = createSupabaseCreatorReportStore({
    from() {
      throw new Error("should not list");
    },
    rpc(name: string, input: unknown) {
      rpcCalls.push([name, input]);
      return {
        async single() {
          return { data: { ...reportRow, status: "Resolved", discard_reason: null }, error: null };
        },
      };
    },
  });
  const handler = createCreatorApiHandler(
    handlerOptions({
      authenticate: async () => ({ actorId: creatorId, rateLimiter: allowingRateLimiter(), store }),
    }),
  );

  const response = await handler(
    request("PATCH", { reportId, status: "Resolved", discardReason: "must be cleared" }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(rpcCalls, [
    [
      "update_report_status",
      {
        p_report_id: reportId,
        p_new_status: "Resolved",
        p_discard_reason: null,
        p_actor_id: creatorId,
        p_request_id: "420cae56-26fb-4f45-9491-5b7766d6d5a7",
      },
    ],
  ]);
  assert.equal((await response.json()).report.status, "Resolved");
});

test("returns a safe error and no success response when the database fails", async () => {
  const handler = createCreatorApiHandler(
    handlerOptions({
      authenticate: async () => ({
        actorId: creatorId,
        rateLimiter: allowingRateLimiter(),
        store: {
          async list() {
            throw new Error("secret database details");
          },
          async updateStatus() {
            throw new Error("secret database details");
          },
        },
      }),
    }),
  );

  const response = await handler(request("GET"));

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: { code: "service_unavailable", message: "Creator API is temporarily unavailable." },
  });
});

test("consumes separate per-actor buckets for creator reads and writes", async () => {
  const calls: unknown[] = [];
  const rateLimiter = allowingRateLimiter((...input) => calls.push(input));
  const handler = createCreatorApiHandler(
    handlerOptions({
      authenticate: async () => ({
        actorId: creatorId,
        rateLimiter,
        store: {
          async list() {
            return [reportRow];
          },
          async updateStatus() {
            return { ...reportRow, status: "Resolved" };
          },
        },
      }),
    }),
  );

  assert.equal((await handler(request("GET"))).status, 200);
  assert.equal((await handler(request("PATCH", { reportId, status: "Resolved" }))).status, 200);
  assert.deepEqual(calls, [
    ["creator:get", creatorId, 120, 60],
    ["creator:patch", creatorId, 30, 60],
  ]);
});

test("returns 429 with Retry-After before a limited creator request reaches the store or body", async () => {
  let storeCalled = false;
  const handler = createCreatorApiHandler(
    handlerOptions({
      authenticate: async () => ({
        actorId: creatorId,
        rateLimiter: {
          async consume() {
            return { allowed: false, retryAfterSeconds: 23 };
          },
        },
        store: {
          async list() {
            storeCalled = true;
            return [];
          },
          async updateStatus() {
            storeCalled = true;
            return reportRow;
          },
        },
      }),
    }),
  );

  const response = await handler(
    new Request("https://example.supabase.co/functions/v1/creator-api", {
      method: "PATCH",
      headers: { origin: allowedOrigin, "content-type": "application/json" },
      body: "not-json",
    }),
  );

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "23");
  assert.equal(storeCalled, false);
  assert.deepEqual(await response.json(), {
    error: { code: "rate_limited", message: "Too many requests." },
  });
});

test("fails closed with a safe 503 when creator rate limiting is unavailable", async () => {
  let storeCalled = false;
  const handler = createCreatorApiHandler(
    handlerOptions({
      authenticate: async () => ({
        actorId: creatorId,
        rateLimiter: {
          async consume() {
            throw new Error("secret database details");
          },
        },
        store: {
          async list() {
            storeCalled = true;
            return [];
          },
          async updateStatus() {
            storeCalled = true;
            return reportRow;
          },
        },
      }),
    }),
  );

  const response = await handler(request("GET"));

  assert.equal(response.status, 503);
  assert.equal(storeCalled, false);
  assert.deepEqual(await response.json(), {
    error: { code: "service_unavailable", message: "Creator API is temporarily unavailable." },
  });
});

test("creates a one-time beta invite from 32 injected random bytes and stores only its hash", async () => {
  const stored: unknown[] = [];
  const handler = createCreatorApiHandler(
    handlerOptions({
      now: () => new Date("2026-08-14T07:20:00.000Z"),
      randomBytes: (length: number) => {
        assert.equal(length, 32);
        return Uint8Array.from({ length }, (_, index) => index);
      },
      authenticate: async () => ({
        actorId: creatorId,
        rateLimiter: allowingRateLimiter(),
        store: {
          async createBetaInvite(input: unknown) {
            stored.push(input);
            return { expiresAt: "2026-08-15T07:20:00.000Z" };
          },
          async list() {
            throw new Error("should not list");
          },
          async updateStatus() {
            throw new Error("should not update");
          },
        },
      }),
    }),
  );

  const response = await handler(request("POST", { action: "create_beta_invite" }));
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(body.code, /^pb_inv_[A-Za-z0-9_-]{43}$/);
  assert.equal(body.expiresAt, "2026-08-15T07:20:00.000Z");
  assert.equal(stored.length, 1);
  const input = stored[0] as Record<string, unknown>;
  assert.match(String(input.tokenHash), /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(input), /pb_inv_/);
  assert.equal(input.creatorId, creatorId);
  assert.equal(input.expiresAt, "2026-08-15T07:20:00.000Z");
});

test("rate limits creator invitation creation to ten per hour before storage", async () => {
  const calls: unknown[] = [];
  let storeCalled = false;
  const handler = createCreatorApiHandler(
    handlerOptions({
      authenticate: async () => ({
        actorId: creatorId,
        rateLimiter: {
          async consume(...input: unknown[]) {
            calls.push(input);
            return { allowed: false, retryAfterSeconds: 91 };
          },
        },
        store: {
          async createBetaInvite() {
            storeCalled = true;
            throw new Error("should not create");
          },
          async list() {
            throw new Error("should not list");
          },
          async updateStatus() {
            throw new Error("should not update");
          },
        },
      }),
    }),
  );

  const response = await handler(request("POST", { action: "create_beta_invite" }));

  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "91");
  assert.deepEqual(calls, [["creator:invite", creatorId, 10, 3_600]]);
  assert.equal(storeCalled, false);
});

test("strictly rejects unknown creator invitation actions", async () => {
  const handler = createCreatorApiHandler(handlerOptions());

  for (const body of [
    { action: "other" },
    { action: "create_beta_invite", expiresInHours: 168 },
  ]) {
    assert.equal((await handler(request("POST", body))).status, 400);
  }
});
