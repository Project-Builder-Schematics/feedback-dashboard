import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps production Auth redirects and MCP OAuth configuration out of localhost", async () => {
  const config = await readFile(new URL("../supabase/config.toml", import.meta.url), "utf8");
  const productionConfig = JSON.parse(
    await readFile(new URL("../supabase/auth-production.json", import.meta.url), "utf8"),
  );

  assert.match(config, /\[auth\][\s\S]*site_url\s*=\s*"https:\/\/project-builder-schematics\.github\.io"/);
  assert.match(config, /https:\/\/project-builder-schematics\.github\.io\/feedback-dashboard\//);
  assert.match(config, /feedback-dashboard\/oauth\/consent/);
  assert.doesNotMatch(config, /localhost|127\.0\.0\.1/);
  assert.match(config, /\[auth\.oauth_server\][\s\S]*enabled\s*=\s*true/);
  assert.match(config, /authorization_url_path\s*=\s*"\/feedback-dashboard\/oauth\/consent\/"/);
  assert.match(config, /allow_dynamic_registration\s*=\s*true/);
  assert.match(config, /\[auth\.hook\.custom_access_token\][\s\S]*enabled\s*=\s*true/);
  assert.match(config, /pg-functions:\/\/postgres\/public\/project_builder_access_token_hook/);
  assert.deepEqual(productionConfig, {
    site_url: "https://project-builder-schematics.github.io",
    uri_allow_list: [
      "https://project-builder-schematics.github.io/feedback-dashboard/",
      "https://project-builder-schematics.github.io/feedback-dashboard/?mode=join",
      "https://project-builder-schematics.github.io/feedback-dashboard/oauth/consent/**",
    ].join(","),
    hook_custom_access_token_enabled: true,
    hook_custom_access_token_uri:
      "pg-functions://postgres/public/project_builder_access_token_hook",
    oauth_server_enabled: true,
    oauth_server_allow_dynamic_registration: true,
    oauth_server_authorization_path: "/feedback-dashboard/oauth/consent/",
    mailer_autoconfirm: false,
    mailer_otp_length: 8,
    smtp_max_frequency: 60,
    mfa_totp_enroll_enabled: true,
    mfa_totp_verify_enabled: true,
  });
});
