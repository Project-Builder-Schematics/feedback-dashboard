import assert from "node:assert/strict";
import test from "node:test";

import { createSupabaseBetaMembershipStore, createTesterApiHandler } from "../_shared/tester-api.ts";

const userId = "a59e96b4-51a4-4da9-9f28-19c807d7b785";
const allowedOrigin = "https://project-builder-schematics.github.io";
const inviteCode = `pb_inv_${"A".repeat(43)}`;

function allowingRateLimiter(onConsume?: (...input: unknown[]) => void) {
  return {
    async consume(...input: unknown[]) {
      onConsume?.(...input);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

function githubIdentity(overrides: Record<string, unknown> = {}) {
  return {
    provider: "github",
    user_id: userId,
    provider_id: "12345678",
    ...overrides,
  };
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    allowedOrigins: allowedOrigin,
    authenticate: async () => ({
      userId,
      isAnonymous: false,
      identities: [githubIdentity()],
      rateLimiter: allowingRateLimiter(),
      store: {
        async redeemInvite() {
          return { redeemed: true };
        },
      },
    }),
    requestId: () => "420cae56-26fb-4f45-9491-5b7766d6d5a7",
    ...overrides,
  };
}

function request(body: unknown, origin = allowedOrigin) {
  return new Request("https://example.supabase.co/functions/v1/tester-api", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("requires a verified non-anonymous GitHub identity linked to the authenticated user", async () => {
  for (const authenticated of [
    null,
    { userId, isAnonymous: true, identities: [githubIdentity()] },
    { userId, isAnonymous: false, identities: [] },
    { userId, isAnonymous: false, identities: [githubIdentity({ user_id: crypto.randomUUID() })] },
    { userId, isAnonymous: false, identities: [githubIdentity({ provider_id: "" })] },
  ]) {
    let rateLimited = false;
    let stored = false;
    const handler = createTesterApiHandler(
      options({
        authenticate: async () =>
          authenticated && {
            ...authenticated,
            rateLimiter: allowingRateLimiter(() => {
              rateLimited = true;
            }),
            store: {
              async redeemInvite() {
                stored = true;
                return { redeemed: true };
              },
            },
          },
      }),
    );

    const response = await handler(request({ code: inviteCode }));
    assert.equal(response.status, authenticated ? 403 : 401);
    assert.equal(rateLimited, false);
    assert.equal(stored, false);
  }
});

test("strictly validates bounded invite input without trusting client identity fields", async () => {
  let stored = false;
  const handler = createTesterApiHandler(
    options({
      authenticate: async () => ({
        userId,
        isAnonymous: false,
        identities: [githubIdentity()],
        rateLimiter: allowingRateLimiter(),
        store: {
          async redeemInvite() {
            stored = true;
            return { redeemed: true };
          },
        },
      }),
    }),
  );

  for (const body of [
    { code: "short" },
    { code: inviteCode, providerId: "spoofed" },
    { code: inviteCode, userId: crypto.randomUUID() },
  ]) {
    assert.equal((await handler(request(body))).status, 400);
  }
  const oversized = new Request("https://example.supabase.co/functions/v1/tester-api", {
    method: "POST",
    headers: { origin: allowedOrigin, "content-type": "application/json" },
    body: JSON.stringify({ code: `pb_inv_${"A".repeat(600)}` }),
  });
  assert.equal((await handler(oversized)).status, 413);
  assert.equal(stored, false);
});

test("rate limits verified users before invite lookup and fails closed", async () => {
  for (const outcome of ["deny", "error"] as const) {
    let stored = false;
    const handler = createTesterApiHandler(
      options({
        authenticate: async () => ({
          userId,
          isAnonymous: false,
          identities: [githubIdentity()],
          rateLimiter: {
            async consume(namespace: string, subject: string, limit: number, windowSeconds: number) {
              assert.deepEqual(
                { namespace, subject, limit, windowSeconds },
                { namespace: "tester:redeem", subject: userId, limit: 10, windowSeconds: 600 },
              );
              if (outcome === "error") throw new Error("limiter unavailable");
              return { allowed: false, retryAfterSeconds: 37 };
            },
          },
          store: {
            async redeemInvite() {
              stored = true;
              return { redeemed: true };
            },
          },
        }),
      }),
    );

    const response = await handler(request({ code: inviteCode }));
    assert.equal(response.status, outcome === "deny" ? 429 : 503);
    assert.equal(response.headers.get("retry-after"), outcome === "deny" ? "37" : null);
    assert.equal(stored, false);
  }
});

test("hashes the code before one redemption RPC and returns no-store success", async () => {
  const calls: unknown[] = [];
  const handler = createTesterApiHandler(
    options({
      authenticate: async () => ({
        userId,
        isAnonymous: false,
        identities: [githubIdentity()],
        rateLimiter: allowingRateLimiter(),
        store: {
          async redeemInvite(input: unknown) {
            calls.push(input);
            return { redeemed: true };
          },
        },
      }),
    }),
  );

  const response = await handler(request({ code: inviteCode }));

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { membership: { status: "active" } });
  assert.equal(calls.length, 1);
  const input = calls[0] as Record<string, unknown>;
  assert.match(String(input.tokenHash), /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(input), /pb_inv_/);
  assert.deepEqual(
    { userId: input.userId, provider: input.provider, providerId: input.providerId },
    { userId, provider: "github", providerId: "12345678" },
  );
});

test("uses one generic response for every rejected redemption", async () => {
  const handler = createTesterApiHandler(
    options({
      authenticate: async () => ({
        userId,
        isAnonymous: false,
        identities: [githubIdentity()],
        rateLimiter: allowingRateLimiter(),
        store: {
          async redeemInvite() {
            return { redeemed: false };
          },
        },
      }),
    }),
  );

  const response = await handler(request({ code: inviteCode }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: { code: "invite_rejected", message: "Invitation could not be redeemed." },
  });
});

test("maps redemption to the single security-definer RPC", async () => {
  const calls: unknown[] = [];
  const store = createSupabaseBetaMembershipStore({
    rpc(name: string, input: Record<string, unknown>) {
      calls.push([name, input]);
      return {
        async single() {
          return { data: { redeemed: true }, error: null };
        },
      };
    },
  });

  assert.deepEqual(
    await store.redeemInvite({
      tokenHash: "a".repeat(64),
      userId,
      provider: "github",
      providerId: "12345678",
      requestId: "420cae56-26fb-4f45-9491-5b7766d6d5a7",
    }),
    { redeemed: true },
  );
  assert.deepEqual(calls, [
    [
      "redeem_beta_invitation",
      {
        p_token_hash_hex: "a".repeat(64),
        p_user_id: userId,
        p_provider: "github",
        p_provider_id: "12345678",
        p_request_id: "420cae56-26fb-4f45-9491-5b7766d6d5a7",
      },
    ],
  ]);
});
