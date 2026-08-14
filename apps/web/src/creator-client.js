import { createClient } from "@supabase/supabase-js";

let browserClient;
export const BETA_INVITE_STORAGE_KEY = "project-builder-beta-invite";

export function getSupabaseClient() {
  if (!browserClient) {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !publishableKey) throw new Error("Supabase browser configuration is missing.");
    browserClient = createClient(url, publishableKey, {
      auth: {
        flowType: "pkce",
        detectSessionInUrl: true,
        persistSession: true,
      },
    });
  }
  return browserClient;
}

export function betaJoinRedirect() {
  return "https://project-builder-schematics.github.io/feedback-dashboard/?mode=join";
}

export async function loadOAuthAuthorization(client, authorizationId) {
  const { data, error } = await client.auth.oauth.getAuthorizationDetails(authorizationId);
  if (error || !data) throw new Error("Unable to load OAuth authorization.");
  return data;
}

export async function decideOAuthAuthorization(client, authorizationId, decision) {
  const method = decision === "approve" ? "approveAuthorization" : "denyAuthorization";
  const { data, error } = await client.auth.oauth[method](authorizationId, {
    skipBrowserRedirect: true,
  });
  if (error || typeof data?.redirect_url !== "string") {
    throw new Error("Unable to complete OAuth authorization.");
  }
  return data.redirect_url;
}

function initials(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

function relativeAge(createdAt, now) {
  const elapsedMinutes = Math.max(0, Math.floor((now.getTime() - new Date(createdAt).getTime()) / 60_000));
  if (elapsedMinutes < 1) return "now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const hours = Math.floor(elapsedMinutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function mapCreatorReport(dto, now = new Date()) {
  return {
    reportId: dto.id,
    id: dto.publicId,
    title: dto.title,
    tester: dto.reporter_display_name,
    initials: initials(dto.reporter_display_name),
    email: dto.reporter_email,
    status: dto.status,
    severity: dto.severity,
    platform: dto.platform,
    version: dto.app_version,
    age: relativeAge(dto.created_at, now),
    submitted: new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(dto.created_at)),
    type: dto.type,
    problem: dto.description,
    expected: dto.expected_behavior,
    trigger: "Not provided",
    failure: "Not provided",
    impact: "Not provided",
    steps: dto.reproduction_steps,
    discardReason: dto.discard_reason,
    attachments: Array.isArray(dto.attachments) ? dto.attachments : [],
  };
}

export async function loadCreatorReports(client) {
  const { data, error } = await client.functions.invoke("creator-api", { method: "GET" });
  if (error || !Array.isArray(data?.reports)) throw new Error("Unable to load reports.");
  return data.reports.map((report) => mapCreatorReport(report));
}

export async function saveCreatorReportStatus(client, body) {
  const { data, error } = await client.functions.invoke("creator-api", {
    method: "PATCH",
    body,
  });
  if (error || !data?.report) throw new Error("Unable to update report status.");
  return mapCreatorReport(data.report);
}

export async function createBetaInvite(client) {
  const { data, error } = await client.functions.invoke("creator-api", {
    method: "POST",
    body: { action: "create_beta_invite" },
  });
  if (
    error ||
    typeof data?.code !== "string" ||
    typeof data?.expiresAt !== "string"
  ) {
    throw new Error("Unable to create beta invitation.");
  }
  return { code: data.code, expiresAt: data.expiresAt };
}

export async function redeemBetaInvite(client, code) {
  const { data, error } = await client.functions.invoke("tester-api", {
    method: "POST",
    body: { code },
  });
  if (error || data?.membership?.status !== "active") {
    throw new Error("Unable to redeem beta invitation.");
  }
}
