import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("deploys the portable feedback API through a Supabase Edge Function", async () => {
  const entrypoint = await readFile(
    new URL("../supabase/functions/feedback-api/index.ts", import.meta.url),
    "utf8",
  );
  const api = await readFile(
    new URL("../supabase/functions/_shared/feedback-api.ts", import.meta.url),
    "utf8",
  );

  assert.match(entrypoint, /export default\s*\{\s*fetch:/);
  assert.match(entrypoint, /SUPABASE_URL/);
  assert.match(entrypoint, /SUPABASE_SECRET_KEYS/);
  assert.match(entrypoint, /PB_FEEDBACK_TOKEN/);
  assert.match(entrypoint, /PB_ALLOWED_ORIGINS/);
  assert.match(entrypoint, /createFeedbackApiHandler/);
  assert.match(entrypoint, /createSupabaseRateLimiter/);
  assert.match(entrypoint, /\.\.\/_shared\/feedback-api\.ts/);
  assert.doesNotMatch(entrypoint, /\.\.\/\.\.\/\.\.\/apps\//);
  assert.doesNotMatch(api, /node:http/);
  assert.doesNotMatch(api, /createServer/);
});

test("keeps the creator API JWT-verified and authorizes from verified sub claims", async () => {
  const entrypoint = await readFile(
    new URL("../supabase/functions/creator-api/index.ts", import.meta.url),
    "utf8",
  );
  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");

  assert.match(config, /\[functions\.creator-api\]\s*\nverify_jwt\s*=\s*true/);
  assert.match(entrypoint, /createSupabaseContext\(request, \{ auth: "user" \}\)/);
  assert.match(entrypoint, /jwtClaims\?\.sub/);
  assert.match(entrypoint, /PB_CREATOR_USER_IDS/);
  assert.match(entrypoint, /createSupabaseRateLimiter/);
  assert.doesNotMatch(entrypoint, /userClaims\?\.email|metadata/);
});

test("keeps tester onboarding JWT-verified and derives GitHub identity through auth getUser", async () => {
  const entrypoint = await readFile(
    new URL("../supabase/functions/tester-api/index.ts", import.meta.url),
    "utf8",
  );
  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");

  assert.match(config, /\[functions\.tester-api\]\s*\nverify_jwt\s*=\s*true/);
  assert.match(entrypoint, /auth\.getUser\(accessToken\)/);
  assert.match(entrypoint, /user\.identities/);
  assert.match(entrypoint, /provider_id/);
  assert.match(entrypoint, /createSupabaseRateLimiter/);
  assert.match(entrypoint, /createSupabaseBetaMembershipStore/);
  assert.doesNotMatch(entrypoint, /user_metadata|email|login|avatar/);
});

test("deploys a stateless OAuth-protected MCP Edge Function", async () => {
  const entrypoint = await readFile(
    new URL("../supabase/functions/project-builder-mcp/index.ts", import.meta.url),
    "utf8",
  );
  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  const imports = await readFile(
    new URL("../supabase/functions/deno.json", import.meta.url),
    "utf8",
  );

  assert.match(config, /\[functions\.project-builder-mcp\]\s*\nverify_jwt\s*=\s*false/);
  assert.match(imports, /npm:@modelcontextprotocol\/sdk@1\.25\.3/);
  assert.match(entrypoint, /WebStandardStreamableHTTPServerTransport/);
  assert.match(entrypoint, /sessionIdGenerator:\s*undefined/);
  assert.match(entrypoint, /enableJsonResponse:\s*true/);
  assert.match(entrypoint, /auth\.getUser\(token\)/);
  assert.match(entrypoint, /createRemoteMcpHttpHandler/);
  assert.match(entrypoint, /createRemoteMcpDataStore/);
  assert.match(entrypoint, /createRemoteReportIssueHandler/);
  assert.match(entrypoint, /reportIssueInputSchema/);
  assert.doesNotMatch(entrypoint, /PB_FEEDBACK_TOKEN/);
});
