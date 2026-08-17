import { z } from "zod";
import { exactCorsHeaders, parseExactOriginAllowlist } from "./exact-cors.ts";
import type { RateLimiter } from "./rate-limit.ts";

const uuid = z.uuid();
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("apply"), email: z.email().max(254) }).strict(),
  z.object({ action: z.literal("list") }).strict(),
  z.object({ action: z.literal("approve"), applicationId: uuid }).strict(),
]);
interface Store {
  submit(input: { userId: string; providerId: string; email: string; requestId: string }): Promise<{ id: string; status: "pending" }>;
  list(): Promise<unknown[]>;
  approve(input: { applicationId: string; actorId: string; requestId: string }): Promise<{ id: string; status: "approved"; email: string; notificationRequired: boolean }>;
  markNotified(applicationId: string): Promise<void>;
}
interface Actor {
  userId: string; email?: string | null;
  identities: Array<{ provider?: unknown; user_id?: unknown; provider_id?: unknown }>;
  rateLimiter: RateLimiter; store: Store;
}
export function createBetaApplicationsHandler(options: {
  allowedOrigins: string; creatorUserIds: string;
  authenticate(request: Request): Promise<Actor | null>;
  sendApprovalEmail?(input: { email: string }): Promise<void>;
  requestId?: () => string;
}) {
  const origins = parseExactOriginAllowlist(options.allowedOrigins);
  const creators = new Set(options.creatorUserIds.split(",").map((value) => value.trim()));
  const nextRequestId = options.requestId ?? (() => crypto.randomUUID());
  return async (request: Request) => {
    const origin = request.headers.get("origin");
    const headers = exactCorsHeaders(origin, origins ?? new Set(), "POST, OPTIONS");
    if (!origins || (origin && !origins.has(origin))) return Response.json({ error: { code: "origin_forbidden" } }, { status: 403, headers });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return Response.json({ error: { code: "method_not_allowed" } }, { status: 405, headers });
    const actor = await options.authenticate(request).catch(() => null);
    if (!actor || !uuid.safeParse(actor.userId).success) return Response.json({ error: { code: "unauthorized" } }, { status: 401, headers });
    const parsed = action.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: { code: "invalid_request" } }, { status: 400, headers });
    const limit = await actor.rateLimiter.consume(`beta:${parsed.data.action}`, actor.userId, parsed.data.action === "apply" ? 3 : 30, 3600);
    if (!limit.allowed) return Response.json({ error: { code: "rate_limited" } }, { status: 429, headers });
    if (parsed.data.action === "apply") {
      const identity = actor.identities.find((item) => item.provider === "github" && item.user_id === actor.userId && typeof item.provider_id === "string" && item.provider_id.trim());
      if (!identity) return Response.json({ error: { code: "github_identity_required" } }, { status: 403, headers });
      const application = await actor.store.submit({ userId: actor.userId, providerId: String(identity.provider_id).trim(), email: parsed.data.email.toLowerCase(), requestId: nextRequestId() });
      return Response.json({ application }, { status: 201, headers });
    }
    if (!creators.has(actor.userId)) return Response.json({ error: { code: "forbidden" } }, { status: 403, headers });
    if (parsed.data.action === "list") return Response.json({ applications: await actor.store.list() }, { status: 200, headers });
    const approved = await actor.store.approve({ applicationId: parsed.data.applicationId, actorId: actor.userId, requestId: nextRequestId() });
    if (approved.notificationRequired) {
      await options.sendApprovalEmail?.({ email: approved.email });
      await actor.store.markNotified(approved.id);
    }
    return Response.json({ application: { id: approved.id, status: approved.status } }, { status: 200, headers });
  };
}
