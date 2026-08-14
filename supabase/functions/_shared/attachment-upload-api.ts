import { z } from "zod";

import { PayloadTooLargeError, readBoundedJsonBody } from "./bounded-json.ts";
import { exactCorsHeaders, parseExactOriginAllowlist } from "./exact-cors.ts";
import type { RateLimiter } from "./rate-limit.ts";
import { sha256Hex } from "./sha256.ts";

const BUCKET = "report-attachments";
const capabilityPattern = /^pb_upload_[A-Za-z0-9_-]{43}$/;
const acceptedImageTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
const acceptedVideoTypes = ["video/mp4", "video/webm", "video/quicktime"] as const;
const acceptedTypes = [...acceptedImageTypes, ...acceptedVideoTypes] as const;
const safeFileName = z.string().trim().min(1).max(255).regex(/^[^/\\\u0000-\u001F\u007F]+$/);

const prepareSchema = z.object({
  action: z.literal("prepare"),
  fileName: safeFileName,
  contentType: z.enum(acceptedTypes),
  sizeBytes: z.number().int().positive(),
}).strict().superRefine((value, context) => {
  const limit = (acceptedImageTypes as readonly string[]).includes(value.contentType)
    ? 10 * 1024 * 1024
    : 50 * 1024 * 1024;
  if (value.sizeBytes > limit) {
    context.addIssue({ code: "custom", message: "File is too large.", path: ["sizeBytes"] });
  }
});

const completeSchema = z.object({
  action: z.literal("complete"),
  attachmentId: z.uuid(),
}).strict();

interface AttachmentUploadStore {
  prepare(input: {
    tokenHash: string;
    fileName: string;
    contentType: string;
    sizeBytes: number;
  }): Promise<{ attachmentId: string; reportId: string; objectPath: string }>;
  findPending(input: {
    tokenHash: string;
    attachmentId: string;
  }): Promise<{ objectPath: string }>;
  fail(input: { tokenHash: string; attachmentId: string }): Promise<void>;
  complete(input: {
    tokenHash: string;
    attachmentId: string;
    sizeBytes: number;
    contentType: string;
  }): Promise<{ reportId: string; status: "ready" | "failed" }>;
}

interface AttachmentStorage {
  createSignedUploadUrl(path: string): Promise<{ path: string; token: string }>;
  info(path: string): Promise<{ size: number; contentType: string }>;
  remove(paths: string[]): Promise<void>;
}

interface AttachmentUploadApiOptions {
  allowedOrigins: string;
  rateLimiter: RateLimiter;
  store: AttachmentUploadStore;
  storage: AttachmentStorage;
  maxBodyBytes?: number;
}

interface SupabaseClientLike {
  rpc(name: string, input: Record<string, unknown>): {
    single(): PromiseLike<{ data: Record<string, unknown> | null; error: unknown }>;
  };
}

function json(body: unknown, status: number, headers: Headers) {
  return Response.json(body, { status, headers });
}

function bearerCapability(request: Request) {
  const match = /^Bearer ([^\s,]+)$/.exec(request.headers.get("authorization") ?? "");
  return match && capabilityPattern.test(match[1]) ? match[1] : null;
}

export function createSupabaseAttachmentUploadStore(
  supabase: SupabaseClientLike,
): AttachmentUploadStore {
  return {
    async prepare(input) {
      const { data, error } = await supabase.rpc("prepare_report_attachment", {
        p_token_hash_hex: input.tokenHash,
        p_file_name: input.fileName,
        p_content_type: input.contentType,
        p_size_bytes: input.sizeBytes,
      }).single();
      if (
        error ||
        typeof data?.attachment_id !== "string" ||
        typeof data?.report_public_id !== "string" ||
        typeof data?.object_path !== "string"
      ) {
        throw new Error("Unable to prepare attachment.");
      }
      return {
        attachmentId: data.attachment_id,
        reportId: data.report_public_id,
        objectPath: data.object_path,
      };
    },

    async findPending(input) {
      const { data, error } = await supabase.rpc("get_pending_report_attachment", {
        p_token_hash_hex: input.tokenHash,
        p_attachment_id: input.attachmentId,
      }).single();
      if (error || typeof data?.object_path !== "string") {
        throw new Error("Attachment is unavailable.");
      }
      return { objectPath: data.object_path };
    },

    async fail(input) {
      const { error } = await supabase.rpc("fail_report_attachment", {
        p_token_hash_hex: input.tokenHash,
        p_attachment_id: input.attachmentId,
      }).single();
      if (error) throw new Error("Unable to release attachment.");
    },

    async complete(input) {
      const { data, error } = await supabase.rpc("complete_report_attachment", {
        p_token_hash_hex: input.tokenHash,
        p_attachment_id: input.attachmentId,
        p_size_bytes: input.sizeBytes,
        p_content_type: input.contentType,
      }).single();
      if (
        error ||
        typeof data?.report_public_id !== "string" ||
        !["ready", "failed"].includes(String(data?.status))
      ) {
        throw new Error("Unable to complete attachment.");
      }
      return {
        reportId: data.report_public_id,
        status: data.status as "ready" | "failed",
      };
    },
  };
}

export function createAttachmentUploadApiHandler({
  allowedOrigins,
  rateLimiter,
  store,
  storage,
  maxBodyBytes = 4_096,
}: AttachmentUploadApiOptions) {
  const allowedOriginSet = parseExactOriginAllowlist(allowedOrigins);

  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("origin");
    const headers = exactCorsHeaders(origin, allowedOriginSet ?? new Set(), "POST, OPTIONS");
    if (!allowedOriginSet) {
      return json({ error: "service_unavailable" }, 503, headers);
    }
    if (origin && !allowedOriginSet.has(origin)) {
      return json({ error: "origin_forbidden" }, 403, headers);
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") {
      headers.set("allow", "POST, OPTIONS");
      return json({ error: "method_not_allowed" }, 405, headers);
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return json({ error: "unsupported_media_type" }, 415, headers);
    }

    const capability = bearerCapability(request);
    if (!capability) return json({ error: "upload_unavailable" }, 401, headers);

    let rateLimit;
    try {
      rateLimit = await rateLimiter.consume("attachment:upload", capability, 30, 60);
    } catch {
      return json({ error: "service_unavailable" }, 503, headers);
    }
    if (!rateLimit.allowed) {
      headers.set("retry-after", String(Math.max(1, rateLimit.retryAfterSeconds)));
      return json({ error: "rate_limited" }, 429, headers);
    }

    let body: unknown;
    try {
      body = await readBoundedJsonBody(request, maxBodyBytes);
    } catch (error) {
      return json(
        { error: error instanceof PayloadTooLargeError ? "payload_too_large" : "invalid_request" },
        error instanceof PayloadTooLargeError ? 413 : 400,
        headers,
      );
    }

    const tokenHash = await sha256Hex(capability);
    const prepare = prepareSchema.safeParse(body);
    if (prepare.success) {
      let attachment: Awaited<ReturnType<AttachmentUploadStore["prepare"]>>;
      try {
        attachment = await store.prepare({ tokenHash, ...prepare.data });
      } catch {
        return json({ error: "upload_unavailable" }, 403, headers);
      }
      try {
        const signed = await storage.createSignedUploadUrl(attachment.objectPath);
        return json(
          {
            attachmentId: attachment.attachmentId,
            reportId: attachment.reportId,
            bucket: BUCKET,
            path: signed.path,
            token: signed.token,
          },
          201,
          headers,
        );
      } catch {
        try {
          await store.fail({ tokenHash, attachmentId: attachment.attachmentId });
        } catch {
          // The private orphan record can be reclaimed by scheduled cleanup.
        }
        return json({ error: "service_unavailable" }, 503, headers);
      }
    }

    const complete = completeSchema.safeParse(body);
    if (complete.success) {
      let pending: { objectPath: string };
      let metadata: { size: number; contentType: string };
      try {
        pending = await store.findPending({ tokenHash, attachmentId: complete.data.attachmentId });
        metadata = await storage.info(pending.objectPath);
      } catch {
        return json({ error: "upload_not_ready" }, 409, headers);
      }

      try {
        const result = await store.complete({
          tokenHash,
          attachmentId: complete.data.attachmentId,
          sizeBytes: metadata.size,
          contentType: metadata.contentType,
        });
        if (result.status !== "ready") {
          try {
            await storage.remove([pending.objectPath]);
          } catch {
            // The private orphan object can be reclaimed by scheduled cleanup.
          }
          return json({ error: "uploaded_file_mismatch" }, 409, headers);
        }
        return json(result, 200, headers);
      } catch {
        return json({ error: "upload_unavailable" }, 403, headers);
      }
    }

    return json({ error: "invalid_request" }, 400, headers);
  };
}
