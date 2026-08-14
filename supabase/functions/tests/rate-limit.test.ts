import assert from "node:assert/strict";
import test from "node:test";

import { createSupabaseRateLimiter } from "../_shared/rate-limit.ts";

test("hashes namespace and subject before consuming an atomic database bucket", async () => {
  const calls: unknown[] = [];
  const limiter = createSupabaseRateLimiter({
    rpc(name: string, input: Record<string, unknown>) {
      calls.push([name, input]);
      return {
        async single() {
          return { data: { allowed: false, retry_after_seconds: 12 }, error: null };
        },
      };
    },
  });

  const result = await limiter.consume("feedback:submit", "raw-secret-token", 60, 60);

  assert.deepEqual(result, { allowed: false, retryAfterSeconds: 12 });
  assert.equal(calls.length, 1);
  const [name, input] = calls[0] as [string, Record<string, unknown>];
  assert.equal(name, "consume_rate_limit");
  assert.match(String(input.p_bucket_hash), /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(input), /raw-secret-token|feedback:submit/);
  assert.deepEqual(
    { p_limit: input.p_limit, p_window_seconds: input.p_window_seconds },
    { p_limit: 60, p_window_seconds: 60 },
  );
});

test("rejects malformed database rate-limit responses", async () => {
  const limiter = createSupabaseRateLimiter({
    rpc() {
      return {
        async single() {
          return { data: { allowed: true, retry_after_seconds: -1 }, error: null };
        },
      };
    },
  });

  await assert.rejects(() => limiter.consume("creator:get", creatorId, 120, 60));
});

const creatorId = "8d53279c-0b9f-4d85-a342-208bf48727f8";
