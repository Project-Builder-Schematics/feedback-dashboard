import { createClient } from "@supabase/supabase-js";

import {
  createAttachmentUploadApiHandler,
  createSupabaseAttachmentUploadStore,
} from "../_shared/attachment-upload-api.ts";
import { createSupabaseRateLimiter } from "../_shared/rate-limit.ts";

function requiredEnvironmentVariable(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const supabaseUrl = requiredEnvironmentVariable("SUPABASE_URL");
const secretKeys = JSON.parse(requiredEnvironmentVariable("SUPABASE_SECRET_KEYS")) as Record<
  string,
  string
>;
const secretKey = secretKeys.default;
if (!secretKey) throw new Error("SUPABASE_SECRET_KEYS must include the default key.");

const supabase = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const bucket = supabase.storage.from("report-attachments");

const fetchHandler = createAttachmentUploadApiHandler({
  allowedOrigins: requiredEnvironmentVariable("PB_ALLOWED_ORIGINS"),
  rateLimiter: createSupabaseRateLimiter(supabase),
  store: createSupabaseAttachmentUploadStore(supabase),
  storage: {
    async createSignedUploadUrl(path) {
      const { data, error } = await bucket.createSignedUploadUrl(path, { upsert: false });
      if (error || !data?.token || !data?.path) throw new Error("Unable to sign upload.");
      return { path: data.path, token: data.token };
    },
    async info(path) {
      const { data, error } = await bucket.info(path);
      if (error || !data) throw new Error("Uploaded object is unavailable.");
      return { size: data.size, contentType: data.contentType };
    },
    async remove(paths) {
      const { error } = await bucket.remove(paths);
      if (error) throw new Error("Unable to remove invalid upload.");
    },
  },
});

export default { fetch: fetchHandler };
