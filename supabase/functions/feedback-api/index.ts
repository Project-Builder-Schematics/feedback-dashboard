import { createClient } from "@supabase/supabase-js";

import {
  createFeedbackApiHandler,
  createSupabaseReportStore,
} from "../_shared/feedback-api.ts";
import { createSupabaseRateLimiter } from "../_shared/rate-limit.ts";

function requiredEnvironmentVariable(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

const secretKeys = JSON.parse(requiredEnvironmentVariable("SUPABASE_SECRET_KEYS")) as Record<
  string,
  string
>;
const secretKey = secretKeys.default;

if (!secretKey) {
  throw new Error("SUPABASE_SECRET_KEYS must include the default key.");
}

const supabase = createClient(requiredEnvironmentVariable("SUPABASE_URL"), secretKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export default {
  fetch: createFeedbackApiHandler({
    betaToken: requiredEnvironmentVariable("PB_FEEDBACK_TOKEN"),
    allowedOrigins: requiredEnvironmentVariable("PB_ALLOWED_ORIGINS")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    rateLimiter: createSupabaseRateLimiter(supabase),
    reportStore: createSupabaseReportStore(supabase),
  }),
};
