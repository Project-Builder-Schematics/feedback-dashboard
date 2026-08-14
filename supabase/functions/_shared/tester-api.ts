import { z } from "zod";

import { PayloadTooLargeError, readBoundedJsonBody } from "./bounded-json.ts";
import { exactCorsHeaders, parseExactOriginAllowlist } from "./exact-cors.ts";
import type { RateLimiter } from "./rate-limit.ts";
import { sha256Hex } from "./sha256.ts";

const uuidSchema = z.uuid();
const redemptionSchema = z
  .object({ code: z.string().regex(/^pb_inv_[A-Za-z0-9_-]{43}$/) })
  .strict();

interface Identity {
  provider?: unknown;
  user_id?: unknown;
  provider_id?: unknown;
}

interface BetaMembershipStore {
  redeemInvite(input: {
    tokenHash: string;
    userId: string;
    provider: "github";
    providerId: string;
    requestId: string;
  }): Promise<{ redeemed: boolean }>;
}

interface AuthenticatedTester {
  userId: string;
  isAnonymous: boolean;
  identities: Identity[];
  rateLimiter: RateLimiter;
  store: BetaMembershipStore;
}

interface TesterApiOptions {
  allowedOrigins: string;
  authenticate(request: Request): Promise<AuthenticatedTester | null>;
  maxBodyBytes?: number;
  requestId?: () => string;
}

interface SupabaseClientLike {
  rpc(name: string, input: Record<string, unknown>): {
    single(): PromiseLike<{
      data: { redeemed?: unknown } | null;
      error: unknown;
    }>;
  };
}

function json(body: unknown, status: number, headers: Headers) {
  return Response.json(body, { status, headers });
}

export function createTesterApiHandler({
  allowedOrigins,
  authenticate,
  maxBodyBytes = 512,
  requestId = () => crypto.randomUUID(),
}: TesterApiOptions) {
  const allowedOriginSet = parseExactOriginAllowlist(allowedOrigins);

  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    const headers = exactCorsHeaders(origin, allowedOriginSet ?? new Set(), "POST, OPTIONS");

    if (!allowedOriginSet) {
      return json(
        { error: { code: "service_unavailable", message: "Tester API is unavailable." } },
        503,
        headers,
      );
    }
    if (origin && !allowedOriginSet.has(origin)) {
      return json(
        { error: { code: "origin_forbidden", message: "Origin is not allowed." } },
        403,
        headers,
      );
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") {
      return json(
        { error: { code: "method_not_allowed", message: "Method not allowed." } },
        405,
        headers,
      );
    }

    let authenticated: AuthenticatedTester | null;
    try {
      authenticated = await authenticate(request);
    } catch {
      authenticated = null;
    }
    if (!authenticated || !uuidSchema.safeParse(authenticated.userId).success) {
      return json(
        { error: { code: "unauthorized", message: "Authentication is required." } },
        401,
        headers,
      );
    }

    const githubIdentity = authenticated.identities.find(
      (identity) =>
        identity.provider === "github" &&
        identity.user_id === authenticated.userId &&
        typeof identity.provider_id === "string" &&
        identity.provider_id.trim().length > 0,
    );
    if (authenticated.isAnonymous || !githubIdentity) {
      return json(
        { error: { code: "github_identity_required", message: "GitHub identity is required." } },
        403,
        headers,
      );
    }

    let rateLimit;
    try {
      rateLimit = await authenticated.rateLimiter.consume(
        "tester:redeem",
        authenticated.userId,
        10,
        600,
      );
    } catch {
      return json(
        { error: { code: "service_unavailable", message: "Tester API is unavailable." } },
        503,
        headers,
      );
    }
    if (!rateLimit.allowed) {
      headers.set("retry-after", String(Math.max(1, rateLimit.retryAfterSeconds)));
      return json(
        { error: { code: "rate_limited", message: "Too many requests." } },
        429,
        headers,
      );
    }

    let body: unknown;
    try {
      body = await readBoundedJsonBody(request, maxBodyBytes);
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        return json(
          { error: { code: "payload_too_large", message: "Request body is too large." } },
          413,
          headers,
        );
      }
      return json(
        { error: { code: "invalid_request", message: "A valid JSON body is required." } },
        400,
        headers,
      );
    }

    const parsed = redemptionSchema.safeParse(body);
    if (!parsed.success) {
      return json(
        { error: { code: "invalid_request", message: "The invitation request is invalid." } },
        400,
        headers,
      );
    }

    try {
      const result = await authenticated.store.redeemInvite({
        tokenHash: await sha256Hex(parsed.data.code),
        userId: authenticated.userId,
        provider: "github",
        providerId: String(githubIdentity.provider_id).trim(),
        requestId: requestId(),
      });
      if (!result.redeemed) {
        return json(
          { error: { code: "invite_rejected", message: "Invitation could not be redeemed." } },
          400,
          headers,
        );
      }
      return json({ membership: { status: "active" } }, 200, headers);
    } catch {
      return json(
        { error: { code: "service_unavailable", message: "Tester API is unavailable." } },
        503,
        headers,
      );
    }
  };
}

export function createSupabaseBetaMembershipStore(
  supabase: SupabaseClientLike,
): BetaMembershipStore {
  return {
    async redeemInvite({ tokenHash, userId, provider, providerId, requestId }) {
      const { data, error } = await supabase
        .rpc("redeem_beta_invitation", {
          p_token_hash_hex: tokenHash,
          p_user_id: userId,
          p_provider: provider,
          p_provider_id: providerId,
          p_request_id: requestId,
        })
        .single();
      if (error || typeof data?.redeemed !== "boolean") {
        throw new Error("Unable to redeem beta invitation.");
      }
      return { redeemed: data.redeemed };
    },
  };
}
