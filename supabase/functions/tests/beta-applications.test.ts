import assert from "node:assert/strict";
import test from "node:test";

import { createBetaApplicationsHandler } from "../_shared/beta-applications.ts";

const userId = "a59e96b4-51a4-4da9-9f28-19c807d7b785";
const creatorId = "8d53279c-0b9f-4d85-a342-208bf48727f8";
const applicationId = "5f52c35f-8334-46b6-ac4d-8f0e52c8d5d9";
const origin = "https://project-builder-schematics.github.io";

function request(body: unknown) {
  return new Request("https://example.supabase.co/functions/v1/beta-applications", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rateLimiter() {
  return { async consume() { return { allowed: true, retryAfterSeconds: 0 }; } };
}

test("records one pending application for the authenticated GitHub identity", async () => {
  const submitted: unknown[] = [];
  const handler = createBetaApplicationsHandler({
    allowedOrigins: origin,
    creatorUserIds: creatorId,
    authenticate: async () => ({
      userId,
      email: "tester@example.com",
      identities: [{ provider: "github", user_id: userId, provider_id: "12345678" }],
      rateLimiter: rateLimiter(),
      store: {
        async submit(input: unknown) {
          submitted.push(input);
          return { id: applicationId, status: "pending" as const };
        },
        async list() { return []; },
        async approve() { throw new Error("not called"); },
        async markNotified() { throw new Error("not called"); },
      },
    }),
    requestId: () => "420cae56-26fb-4f45-9491-5b7766d6d5a7",
  });

  const response = await handler(request({ action: "apply" }));

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    application: { id: applicationId, status: "pending" },
  });
  assert.deepEqual(submitted, [{
    userId,
    providerId: "12345678",
    email: "tester@example.com",
    requestId: "420cae56-26fb-4f45-9491-5b7766d6d5a7",
  }]);
});

test("approves a pending application and sends the MCP access email once", async () => {
  const sent: unknown[] = [];
  const marked: string[] = [];
  const handler = createBetaApplicationsHandler({
    allowedOrigins: origin,
    creatorUserIds: creatorId,
    authenticate: async () => ({
      userId: creatorId,
      email: "creator@example.com",
      identities: [{ provider: "github", user_id: creatorId, provider_id: "87654321" }],
      rateLimiter: rateLimiter(),
      store: {
        async submit() { throw new Error("not called"); },
        async list() { return []; },
        async approve() {
          return { id: applicationId, status: "approved" as const, email: "tester@example.com", notificationRequired: true };
        },
        async markNotified(id: string) { marked.push(id); },
      },
    }),
    sendApprovalEmail: async (input) => { sent.push(input); },
  });

  const response = await handler(request({ action: "approve", applicationId }));

  assert.equal(response.status, 200);
  assert.deepEqual(sent, [{ email: "tester@example.com" }]);
  assert.deepEqual(marked, [applicationId]);
  assert.deepEqual(await response.json(), {
    application: { id: applicationId, status: "approved" },
  });
});
