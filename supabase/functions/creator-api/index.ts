import { createSupabaseContext } from "@supabase/server";

import {
  createCreatorApiHandler,
  createSupabaseCreatorReportStore,
} from "../_shared/creator-api.ts";
import { createSupabaseRateLimiter } from "../_shared/rate-limit.ts";

function requiredEnvironmentVariable(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export default {
  fetch: createCreatorApiHandler({
    creatorUserIds: requiredEnvironmentVariable("PB_CREATOR_USER_IDS"),
    allowedOrigins: requiredEnvironmentVariable("PB_ALLOWED_ORIGINS"),
    authenticate: async (request) => {
      const { data: context, error } = await createSupabaseContext(request, { auth: "user" });
      const actorId = context?.jwtClaims?.sub;
      if (error || !context || typeof actorId !== "string") return null;
      return {
        actorId,
        rateLimiter: createSupabaseRateLimiter(context.supabaseAdmin),
        store: createSupabaseCreatorReportStore(context.supabaseAdmin),
      };
    },
  }),
};
