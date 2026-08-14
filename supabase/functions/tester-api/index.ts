import { createClient } from "@supabase/supabase-js";

import {
  createSupabaseBetaMembershipStore,
  createTesterApiHandler,
} from "../_shared/tester-api.ts";
import { createSupabaseRateLimiter } from "../_shared/rate-limit.ts";

function requiredEnvironmentVariable(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}

const secretKeys = JSON.parse(requiredEnvironmentVariable("SUPABASE_SECRET_KEYS")) as Record<
  string,
  string
>;
const secretKey = secretKeys.default;
if (!secretKey) throw new Error("SUPABASE_SECRET_KEYS must include the default key.");

const supabase = createClient(requiredEnvironmentVariable("SUPABASE_URL"), secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export default {
  fetch: createTesterApiHandler({
    allowedOrigins: requiredEnvironmentVariable("PB_ALLOWED_ORIGINS"),
    authenticate: async (request) => {
      const accessToken = bearerToken(request);
      if (!accessToken) return null;
      const { data, error } = await supabase.auth.getUser(accessToken);
      const user = data.user;
      if (error || !user) return null;
      return {
        userId: user.id,
        isAnonymous: user.is_anonymous === true,
        identities: (user.identities ?? []).map((identity) => ({
          provider: identity.provider,
          user_id: identity.user_id,
          provider_id: identity.provider_id,
        })),
        rateLimiter: createSupabaseRateLimiter(supabase),
        store: createSupabaseBetaMembershipStore(supabase),
      };
    },
  }),
};
