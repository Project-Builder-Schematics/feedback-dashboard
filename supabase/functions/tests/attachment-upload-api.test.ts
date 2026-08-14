import assert from "node:assert/strict";
import test from "node:test";

import { createAttachmentUploadApiHandler } from "../_shared/attachment-upload-api.ts";

const origin = "https://project-builder-schematics.github.io";
const endpoint = "https://example.supabase.co/functions/v1/attachment-upload-api";
const capability = `pb_upload_${"A".repeat(43)}`;

function request(body: unknown, authorization = `Bearer ${capability}`) {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify(body),
  });
}

function options(overrides: Record<string, unknown> = {}) {
  return {
    allowedOrigins: origin,
    rateLimiter: {
      async consume() {
        return { allowed: true, retryAfterSeconds: 0 };
      },
    },
    store: {
      async prepare() {
        return {
          attachmentId: "3ca92c31-28c7-4d65-afaf-8f5c8d91f183",
          reportId: "PB-42",
          objectPath: "reports/report-id/attachment-id",
        };
      },
      async findPending() {
        return { objectPath: "reports/report-id/attachment-id" };
      },
      async fail() {},
      async complete() {
        return { reportId: "PB-42", status: "ready" };
      },
    },
    storage: {
      async createSignedUploadUrl(path: string) {
        return { path, token: "signed-storage-token" };
      },
      async info() {
        return { size: 1024, contentType: "image/png" };
      },
      async remove() {},
    },
    ...overrides,
  };
}

test("handles exact-origin preflight before capability authentication", async () => {
  const handler = createAttachmentUploadApiHandler(options());
  const response = await handler(new Request(endpoint, { method: "OPTIONS", headers: { origin } }));

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), origin);
});

test("prepares a signed private upload using only the hashed capability", async () => {
  const calls: unknown[] = [];
  const handler = createAttachmentUploadApiHandler(
    options({
      store: {
        async prepare(input: unknown) {
          calls.push(input);
          return {
            attachmentId: "3ca92c31-28c7-4d65-afaf-8f5c8d91f183",
            reportId: "PB-42",
            objectPath: "reports/report-id/attachment-id",
          };
        },
        async complete() {
          throw new Error("not expected");
        },
        async fail() {},
        async findPending() {
          throw new Error("not expected");
        },
      },
    }),
  );

  const response = await handler(
    request({
      action: "prepare",
      fileName: "broken-screen.png",
      contentType: "image/png",
      sizeBytes: 1024,
    }),
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    attachmentId: "3ca92c31-28c7-4d65-afaf-8f5c8d91f183",
    reportId: "PB-42",
    bucket: "report-attachments",
    path: "reports/report-id/attachment-id",
    token: "signed-storage-token",
  });
  const stored = calls[0] as Record<string, unknown>;
  assert.match(String(stored.tokenHash), /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(stored), /pb_upload_/);
});

test("rejects unsupported files before creating a signed upload", async () => {
  let prepared = false;
  const handler = createAttachmentUploadApiHandler(
    options({
      store: {
        async prepare() {
          prepared = true;
          throw new Error("not expected");
        },
        async complete() {
          throw new Error("not expected");
        },
        async fail() {},
        async findPending() {
          throw new Error("not expected");
        },
      },
    }),
  );

  for (const body of [
    { action: "prepare", fileName: "notes.pdf", contentType: "application/pdf", sizeBytes: 10 },
    {
      action: "prepare",
      fileName: "huge.png",
      contentType: "image/png",
      sizeBytes: 10 * 1024 * 1024 + 1,
    },
    {
      action: "prepare",
      fileName: "huge.mp4",
      contentType: "video/mp4",
      sizeBytes: 50 * 1024 * 1024 + 1,
    },
  ]) {
    assert.equal((await handler(request(body))).status, 400);
  }
  assert.equal(prepared, false);
});

test("verifies stored object metadata before completing an attachment", async () => {
  const completed: unknown[] = [];
  const handler = createAttachmentUploadApiHandler(
    options({
      store: {
        async prepare() {
          throw new Error("not expected");
        },
        async findPending() {
          return { objectPath: "reports/report-id/attachment-id" };
        },
        async complete(input: unknown) {
          completed.push(input);
          return { reportId: "PB-42", status: "ready" };
        },
        async fail() {},
      },
    }),
  );

  const response = await handler(
    request({
      action: "complete",
      attachmentId: "3ca92c31-28c7-4d65-afaf-8f5c8d91f183",
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { reportId: "PB-42", status: "ready" });
  assert.match(String((completed[0] as Record<string, unknown>).tokenHash), /^[a-f0-9]{64}$/);
  assert.deepEqual(
    {
      sizeBytes: (completed[0] as Record<string, unknown>).sizeBytes,
      contentType: (completed[0] as Record<string, unknown>).contentType,
    },
    { sizeBytes: 1024, contentType: "image/png" },
  );
});

test("releases a prepared slot when storage signing fails", async () => {
  const failed: unknown[] = [];
  const handler = createAttachmentUploadApiHandler(
    options({
      store: {
        async prepare() {
          return {
            attachmentId: "3ca92c31-28c7-4d65-afaf-8f5c8d91f183",
            reportId: "PB-42",
            objectPath: "reports/report-id/attachment-id",
          };
        },
        async findPending() {
          throw new Error("not expected");
        },
        async fail(input: unknown) {
          failed.push(input);
        },
        async complete() {
          throw new Error("not expected");
        },
      },
      storage: {
        async createSignedUploadUrl() {
          throw new Error("storage unavailable");
        },
        async info() {
          throw new Error("not expected");
        },
        async remove() {},
      },
    }),
  );

  const response = await handler(
    request({
      action: "prepare",
      fileName: "broken-screen.png",
      contentType: "image/png",
      sizeBytes: 1024,
    }),
  );

  assert.equal(response.status, 503);
  assert.equal(failed.length, 1);
  assert.match(String((failed[0] as Record<string, unknown>).tokenHash), /^[a-f0-9]{64}$/);
  assert.equal(
    (failed[0] as Record<string, unknown>).attachmentId,
    "3ca92c31-28c7-4d65-afaf-8f5c8d91f183",
  );
});
