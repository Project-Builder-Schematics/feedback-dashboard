import { z } from "zod";

import { PayloadTooLargeError, readBoundedJsonBody } from "./bounded-json.ts";
import { exactCorsHeaders, parseExactOriginAllowlist } from "./exact-cors.ts";
import { reportStatuses, toUtcIsoDatetime } from "./report-contracts.ts";
import type { RateLimiter } from "./rate-limit.ts";
import { sha256Hex } from "./sha256.ts";

export const CREATOR_REPORT_COLUMNS = [
  "id",
  "public_number",
  "title",
  "reporter_display_name",
  "reporter_email",
  "status",
  "severity",
  "platform",
  "app_version",
  "type",
  "description",
  "expected_behavior",
  "reproduction_steps",
  "discard_reason",
  "created_at",
  "updated_at",
].join(", ");

const uuidSchema = z.uuid();
const createBetaInviteSchema = z.object({ action: z.literal("create_beta_invite") }).strict();
const statusUpdateSchema = z
  .object({
    reportId: uuidSchema,
    status: z.enum(reportStatuses),
    discardReason: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "Discarded" && !value.discardReason?.trim()) {
      context.addIssue({
        code: "custom",
        message: "A discard reason is required.",
        path: ["discardReason"],
      });
    }
  });

type ReportRow = Record<string, unknown> & {
  id: string;
  public_number?: number;
  publicId?: string;
  created_at: string;
  updated_at: string;
  attachments?: CreatorAttachment[];
};

interface CreatorAttachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  signedUrl: string;
  createdAt: string;
}

interface AttachmentRow {
  id: string;
  report_id: string;
  original_file_name: string;
  content_type: string;
  size_bytes: number;
  object_path: string;
  created_at: string;
}

interface AttachmentUrlSigner {
  createSignedUrls(
    paths: string[],
    expiresIn: number,
  ): Promise<Array<{ path: string; signedUrl: string }>>;
}

interface CreatorReportStore {
  createBetaInvite(input: {
    tokenHash: string;
    creatorId: string;
    expiresAt: string;
    requestId: string;
  }): Promise<{ expiresAt: string }>;
  list(): Promise<ReportRow[]>;
  updateStatus(input: {
    reportId: string;
    status: (typeof reportStatuses)[number];
    discardReason: string | null;
    actorId: string;
    requestId: string;
  }): Promise<ReportRow>;
}

interface AuthenticatedCreator {
  actorId: string;
  rateLimiter: RateLimiter;
  store: CreatorReportStore;
}

interface CreatorApiOptions {
  creatorUserIds: string;
  allowedOrigins: string;
  authenticate(request: Request): Promise<AuthenticatedCreator | null>;
  maxBodyBytes?: number;
  now?: () => Date;
  randomBytes?: (length: number) => Uint8Array;
  requestId?: () => string;
}

interface SupabaseClientLike {
  from(table: string): {
    select(columns: string): unknown;
  };
  rpc(name: string, input: Record<string, unknown>): {
    single(): PromiseLike<{ data: Record<string, unknown> | null; error: unknown }>;
  };
}

interface ReportSelectQuery {
  order(column: string, options: { ascending: boolean }): {
    limit(value: number): PromiseLike<{ data: ReportRow[] | null; error: unknown }>;
  };
}

interface AttachmentSelectQuery {
  in(column: string, values: string[]): {
    eq(column: string, value: string): {
      order(
        column: string,
        options: { ascending: boolean },
      ): PromiseLike<{ data: AttachmentRow[] | null; error: unknown }>;
    };
  };
}

function parseUuidAllowlist(value: string) {
  const values = value.split(",").map((item) => item.trim());
  if (values.length === 0 || values.some((item) => !uuidSchema.safeParse(item).success)) {
    return null;
  }
  return new Set(values);
}

function json(body: unknown, status: number, headers: Headers) {
  return Response.json(body, { status, headers });
}

function toCreatorReportDto(row: ReportRow) {
  return {
    ...row,
    publicId: row.publicId ?? `PB-${row.public_number}`,
    created_at: toUtcIsoDatetime(row.created_at),
    updated_at: toUtcIsoDatetime(row.updated_at),
  };
}

function invitationCode(randomBytes: (length: number) => Uint8Array) {
  const bytes = randomBytes(32);
  if (bytes.byteLength !== 32) throw new Error("Invitation entropy is unavailable.");
  const encoded = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `pb_inv_${encoded}`;
}

export function createCreatorApiHandler({
  creatorUserIds,
  allowedOrigins,
  authenticate,
  maxBodyBytes = 4_096,
  now = () => new Date(),
  randomBytes = (length) => crypto.getRandomValues(new Uint8Array(length)),
  requestId = () => crypto.randomUUID(),
}: CreatorApiOptions) {
  const allowedCreatorIds = parseUuidAllowlist(creatorUserIds);
  const allowedOriginSet = parseExactOriginAllowlist(allowedOrigins);

  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    const headers = exactCorsHeaders(origin, allowedOriginSet ?? new Set(), "GET, PATCH, POST, OPTIONS");

    if (!allowedCreatorIds || !allowedOriginSet) {
      return json(
        { error: { code: "service_unavailable", message: "Creator API is unavailable." } },
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
    if (!["GET", "PATCH", "POST"].includes(request.method)) {
      return json(
        { error: { code: "method_not_allowed", message: "Method not allowed." } },
        405,
        headers,
      );
    }

    let authenticated: AuthenticatedCreator | null;
    try {
      authenticated = await authenticate(request);
    } catch {
      authenticated = null;
    }
    if (!authenticated) {
      return json(
        { error: { code: "unauthorized", message: "Authentication is required." } },
        401,
        headers,
      );
    }
    if (!allowedCreatorIds.has(authenticated.actorId)) {
      return json({ error: { code: "forbidden", message: "Access is forbidden." } }, 403, headers);
    }

    let rateLimit;
    try {
      const rateLimitConfig =
        request.method === "GET"
          ? ["creator:get", 120, 60]
          : request.method === "PATCH"
            ? ["creator:patch", 30, 60]
            : ["creator:invite", 10, 3_600];
      rateLimit = await authenticated.rateLimiter.consume(
        rateLimitConfig[0] as string,
        authenticated.actorId,
        rateLimitConfig[1] as number,
        rateLimitConfig[2] as number,
      );
    } catch {
      return json(
        {
          error: {
            code: "service_unavailable",
            message: "Creator API is temporarily unavailable.",
          },
        },
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

    try {
      if (request.method === "GET") {
        const reports = await authenticated.store.list();
        return json({ reports: reports.map(toCreatorReportDto) }, 200, headers);
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

      if (request.method === "POST") {
        const parsed = createBetaInviteSchema.safeParse(body);
        if (!parsed.success) {
          return json(
            { error: { code: "invalid_request", message: "The invitation request is invalid." } },
            400,
            headers,
          );
        }
        const code = invitationCode(randomBytes);
        const expiresAt = new Date(now().getTime() + 24 * 60 * 60 * 1_000).toISOString();
        const created = await authenticated.store.createBetaInvite({
          tokenHash: await sha256Hex(code),
          creatorId: authenticated.actorId,
          expiresAt,
          requestId: requestId(),
        });
        return json({ code, expiresAt: toUtcIsoDatetime(created.expiresAt) }, 201, headers);
      }

      const parsed = statusUpdateSchema.safeParse(body);
      if (!parsed.success) {
        return json(
          { error: { code: "invalid_request", message: "The status update is invalid." } },
          400,
          headers,
        );
      }

      const report = await authenticated.store.updateStatus({
        reportId: parsed.data.reportId,
        status: parsed.data.status,
        discardReason:
          parsed.data.status === "Discarded" ? parsed.data.discardReason?.trim() ?? null : null,
        actorId: authenticated.actorId,
        requestId: requestId(),
      });
      return json({ report: toCreatorReportDto(report) }, 200, headers);
    } catch {
      return json(
        {
          error: {
            code: "service_unavailable",
            message: "Creator API is temporarily unavailable.",
          },
        },
        503,
        headers,
      );
    }
  };
}

export function createSupabaseCreatorReportStore(
  supabase: SupabaseClientLike,
  attachmentUrlSigner: AttachmentUrlSigner,
): CreatorReportStore {
  return {
    async createBetaInvite({ tokenHash, creatorId, expiresAt, requestId }) {
      const { data, error } = await supabase
        .rpc("create_beta_invitation", {
          p_token_hash_hex: tokenHash,
          p_created_by: creatorId,
          p_expires_at: expiresAt,
          p_request_id: requestId,
        })
        .single();
      if (error || typeof data?.expires_at !== "string") {
        throw new Error("Unable to create beta invitation.");
      }
      return { expiresAt: data.expires_at };
    },
    async list() {
      const reportQuery = supabase
        .from("reports")
        .select(CREATOR_REPORT_COLUMNS) as ReportSelectQuery;
      const { data, error } = await reportQuery
        .order("created_at", { ascending: false })
        .limit(100);
      if (error || !data) throw new Error("Unable to list reports.");
      if (data.length === 0) return [];

      const attachmentQuery = supabase
        .from("report_attachments")
        .select(
          "id, report_id, original_file_name, content_type, size_bytes, object_path, created_at",
        ) as AttachmentSelectQuery;
      const { data: attachments, error: attachmentError } = await attachmentQuery
        .in("report_id", data.map((report) => report.id))
        .eq("status", "ready")
        .order("created_at", { ascending: true });
      if (attachmentError || !attachments) throw new Error("Unable to list report attachments.");

      const signedUrls = await attachmentUrlSigner.createSignedUrls(
        attachments.map((attachment) => attachment.object_path),
        900,
      );
      const signedUrlByPath = new Map(signedUrls.map((item) => [item.path, item.signedUrl]));
      const attachmentsByReport = new Map<string, CreatorAttachment[]>();
      for (const attachment of attachments) {
        const signedUrl = signedUrlByPath.get(attachment.object_path);
        if (!signedUrl) throw new Error("Unable to sign report attachment.");
        const reportAttachments = attachmentsByReport.get(attachment.report_id) ?? [];
        reportAttachments.push({
          id: attachment.id,
          fileName: attachment.original_file_name,
          contentType: attachment.content_type,
          sizeBytes: attachment.size_bytes,
          signedUrl,
          createdAt: toUtcIsoDatetime(attachment.created_at),
        });
        attachmentsByReport.set(attachment.report_id, reportAttachments);
      }

      return data.map((report) =>
        toCreatorReportDto({
          ...report,
          attachments: attachmentsByReport.get(report.id) ?? [],
        }),
      );
    },
    async updateStatus({ reportId, status, discardReason, actorId, requestId }) {
      const { data, error } = await supabase
        .rpc("update_report_status", {
          p_report_id: reportId,
          p_new_status: status,
          p_discard_reason: discardReason,
          p_actor_id: actorId,
          p_request_id: requestId,
        })
        .single();
      if (error || !data) throw new Error("Unable to update report status.");
      return toCreatorReportDto(data as ReportRow);
    },
  };
}
