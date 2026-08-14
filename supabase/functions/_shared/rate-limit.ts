export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(
    namespace: string,
    subject: string,
    limit: number,
    windowSeconds: number,
  ): Promise<RateLimitResult>;
}

interface RateLimitRow {
  allowed: boolean;
  retry_after_seconds: number;
}

interface SupabaseClientLike {
  rpc(name: string, input: Record<string, unknown>): {
    single(): PromiseLike<{ data: RateLimitRow | null; error: unknown }>;
  };
}

export function createSupabaseRateLimiter(supabase: SupabaseClientLike): RateLimiter {
  return {
    async consume(namespace, subject, limit, windowSeconds) {
      if (!namespace || !subject) throw new Error("Rate-limit identity is required.");

      const { data, error } = await supabase
        .rpc("consume_rate_limit", {
          p_bucket_hash: await sha256Hex(`${namespace}\0${subject}`),
          p_limit: limit,
          p_window_seconds: windowSeconds,
        })
        .single();

      if (
        error ||
        !data ||
        typeof data.allowed !== "boolean" ||
        !Number.isInteger(data.retry_after_seconds) ||
        data.retry_after_seconds < 0
      ) {
        throw new Error("Unable to consume rate limit.");
      }

      return {
        allowed: data.allowed,
        retryAfterSeconds: data.retry_after_seconds,
      };
    },
  };
}
import { sha256Hex } from "./sha256.ts";
