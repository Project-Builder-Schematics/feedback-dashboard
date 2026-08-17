import { createClient } from "@supabase/supabase-js";
import { createBetaApplicationsHandler } from "../_shared/beta-applications.ts";
import { createSupabaseRateLimiter } from "../_shared/rate-limit.ts";

const env = (name: string) => { const value = Deno.env.get(name)?.trim(); if (!value) throw new Error(`${name} is required.`); return value; };
const supabase = createClient(env("SUPABASE_URL"), JSON.parse(env("SUPABASE_SECRET_KEYS")).default, { auth: { persistSession: false } });
const store = {
  async submit(input: { userId: string; providerId: string; email: string }) {
    const { data, error } = await supabase.rpc("submit_beta_application", { p_user_id: input.userId, p_provider_id: input.providerId, p_email: input.email }).single();
    if (error || !data) throw new Error("Unable to submit application.");
    return { id: data.id, status: "pending" as const };
  },
  async list() {
    const { data, error } = await supabase.from("beta_applications").select("id, email, status, created_at").order("created_at", { ascending: false });
    if (error || !data) throw new Error("Unable to list applications.");
    return data;
  },
  async approve(input: { applicationId: string; actorId: string }) {
    const { data, error } = await supabase.rpc("approve_beta_application", { p_application_id: input.applicationId, p_actor_id: input.actorId }).single();
    if (error || !data) throw new Error("Unable to approve application.");
    return { id: data.id, email: data.email, status: "approved" as const, notificationRequired: data.notification_required };
  },
  async markNotified(applicationId: string) {
    const { error } = await supabase.from("beta_applications").update({ notified_at: new Date().toISOString() }).eq("id", applicationId).is("notified_at", null);
    if (error) throw new Error("Unable to record approval notification.");
  },
};

export default { fetch: createBetaApplicationsHandler({
  allowedOrigins: env("PB_ALLOWED_ORIGINS"), creatorUserIds: env("PB_CREATOR_USER_IDS"),
  authenticate: async (request) => {
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
    if (!token) return null;
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return null;
    return { userId: data.user.id, email: data.user.email, identities: data.user.identities ?? [], rateLimiter: createSupabaseRateLimiter(supabase), store };
  },
  sendApprovalEmail: async ({ email }) => {
    const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { authorization: `Bearer ${env("RESEND_API_KEY")}`, "content-type": "application/json" }, body: JSON.stringify({ from: env("PB_BETA_FROM_EMAIL"), to: [email], subject: "Your Project Builder beta access is ready", html: '<p>Your beta access is active. You can now sign in to the Project Builder feedback MCP with GitHub.</p>' }) });
    if (!response.ok) throw new Error("Unable to send approval email.");
  },
}) };
