import {
  createReportRequestSchema,
  reportResponseSchema,
  type CreateReportRequest,
  type ReportResponse,
} from "./report-contracts.ts";
import { PayloadTooLargeError, readBoundedJsonBody } from "./bounded-json.ts";
import type { RateLimiter } from "./rate-limit.ts";

interface ReportStore {
  insert(report: CreateReportRequest): Promise<ReportResponse>;
}

interface FeedbackApiOptions {
  betaToken: string;
  allowedOrigins?: readonly string[];
  maxBodyBytes?: number;
  rateLimiter: RateLimiter;
  reportStore: ReportStore;
}

interface SupabaseInsertResult {
  data: {
    id: string;
    public_number: number;
    status: string;
    created_at: string;
  } | null;
  error: unknown;
}

interface SupabaseClientLike {
  from(table: string): {
    insert(rows: Record<string, unknown>[]): {
      select(columns?: string): {
        single(): PromiseLike<SupabaseInsertResult>;
      };
    };
  };
}

function corsHeaders(origin: string | null, allowedOrigins: readonly string[]) {
  const headers = new Headers({
    "cache-control": "no-store",
  });

  if (origin && allowedOrigins.includes(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "POST, GET, OPTIONS");
    headers.set(
      "access-control-allow-headers",
      "authorization, x-client-info, apikey, content-type",
    );
    headers.set("vary", "Origin");
  }

  return headers;
}

function json(body: unknown, status: number, headers: Headers) {
  return Response.json(body, { status, headers });
}

function isRoute(pathname: string, route: string) {
  return pathname === route || pathname.endsWith(`/feedback-api${route}`);
}

export function createFeedbackApiHandler({
  betaToken,
  allowedOrigins = [],
  maxBodyBytes = 65_536,
  rateLimiter,
  reportStore,
}: FeedbackApiOptions) {
  return async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);
    const origin = request.headers.get("origin");
    const headers = corsHeaders(origin, allowedOrigins);

    if (origin && !allowedOrigins.includes(origin)) {
      return json(
        { error: { code: "origin_forbidden", message: "Origin is not allowed." } },
        403,
        headers,
      );
    }

    if (request.method === "OPTIONS" && isRoute(pathname, "/v1/reports")) {
      return new Response(null, { status: 204, headers });
    }

    if (request.method === "GET" && isRoute(pathname, "/health")) {
      return json({ status: "ok" }, 200, headers);
    }

    if (!isRoute(pathname, "/v1/reports")) {
      return json({ error: { code: "not_found", message: "Route not found." } }, 404, headers);
    }

    if (request.method !== "POST") {
      return json(
        { error: { code: "method_not_allowed", message: "Method not allowed." } },
        405,
        headers,
      );
    }

    if (!betaToken || request.headers.get("authorization") !== `Bearer ${betaToken}`) {
      return json(
        { error: { code: "unauthorized", message: "Authorization is required." } },
        401,
        headers,
      );
    }

    let rateLimit;
    try {
      rateLimit = await rateLimiter.consume("feedback:submit", betaToken, 60, 60);
    } catch {
      return json(
        {
          error: {
            code: "service_unavailable",
            message: "Report submission is temporarily unavailable.",
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

    let payload: unknown;
    try {
      payload = await readBoundedJsonBody(request, maxBodyBytes);
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

    const parsed = createReportRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return json(
        {
          error: {
            code: "invalid_request",
            message: "The report payload is invalid.",
            fields: parsed.error.flatten().fieldErrors,
          },
        },
        400,
        headers,
      );
    }

    try {
      return json(await reportStore.insert(parsed.data), 201, headers);
    } catch {
      return json(
        {
          error: {
            code: "service_unavailable",
            message: "Report submission is temporarily unavailable.",
          },
        },
        503,
        headers,
      );
    }
  };
}

export function createSupabaseReportStore(supabase: SupabaseClientLike): ReportStore {
  return {
    async insert(report) {
      const { data, error } = await supabase
        .from("reports")
        .insert([
          {
            title: report.title,
            description: report.description,
            expected_behavior: report.expectedBehavior,
            reproduction_steps: report.reproductionSteps,
            severity: report.severity,
            type: report.type,
            platform: report.platform,
            app_version: report.appVersion,
            reporter_display_name: report.reporterDisplayName,
            reporter_email: report.reporterEmail,
          },
        ])
        .select("id, public_number, status, created_at")
        .single();

      if (error || !data) {
        throw new Error("Supabase did not persist the report.");
      }

      return reportResponseSchema.parse({
        id: data.id,
        publicId: `PB-${data.public_number}`,
        status: data.status,
        submittedAt: data.created_at,
      });
    },
  };
}
