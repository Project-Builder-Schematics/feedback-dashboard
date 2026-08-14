import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("deploys the tested Vite client to GitHub Pages on relevant pushes to main", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/deploy-pages.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/);
  assert.match(workflow, /paths:\s*\n\s*- "apps\/web\/\*\*"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.match(workflow, /concurrency:\s*\n\s*group:\s*pages/);
  assert.match(workflow, /cancel-in-progress:\s*true/);
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
  assert.match(workflow, /pages:\s*write/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /needs:\s*build/);
  assert.match(workflow, /environment:\s*\n\s*name:\s*github-pages/);
  assert.doesNotMatch(workflow, /ENABLE_CREATOR_API/);
  assert.match(workflow, /actions\/checkout@d23441a48e516b6c34aea4fa41551a30e30af803/);
  assert.match(workflow, /actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020/);
  assert.match(workflow, /persist-credentials:\s*false/);
  assert.match(workflow, /run:\s*npm ci/);
  assert.match(workflow, /run:\s*npm test/);
  assert.match(workflow, /run:\s*npm --workspace apps\/web run build/);
  assert.match(workflow, /actions\/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b/);
  assert.match(workflow, /actions\/upload-pages-artifact@7b1f4a764d45c48632c6b24a0339c27f5614fb0b/);
  assert.match(workflow, /actions\/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e/);
  assert.match(workflow, /path:\s*apps\/web\/dist\/client/);
  assert.match(workflow, /VITE_BASE_PATH:\s*\/feedback-dashboard\//);
  assert.match(workflow, /VITE_SUPABASE_URL:\s*\$\{\{\s*vars\.SUPABASE_URL\s*\}\}/);
  assert.match(
    workflow,
    /VITE_SUPABASE_PUBLISHABLE_KEY:\s*\$\{\{\s*secrets\.SUPABASE_PUBLISHABLE_KEY\s*\}\}/,
  );

  const install = workflow.indexOf("run: npm ci");
  const tests = workflow.indexOf("run: npm test");
  const build = workflow.indexOf("run: npm --workspace apps/web run build");
  const upload = workflow.indexOf("actions/upload-pages-artifact@");

  assert.ok(install < tests && tests < build && build < upload);
});

test("keeps backend secrets out of the browser bundle configuration", async () => {
  const manifest = await readFile(new URL("../apps/web/package.json", import.meta.url), "utf8");
  const client = await readFile(new URL("../apps/web/src/creator-client.js", import.meta.url), "utf8");

  assert.match(manifest, /@supabase\/supabase-js/);
  assert.match(client, /VITE_SUPABASE_URL/);
  assert.match(client, /VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(client, /SECRET|SERVICE_ROLE|PB_FEEDBACK_TOKEN/);
  assert.match(client, /flowType:\s*"pkce"/);
  assert.match(client, /detectSessionInUrl:\s*true/);
  assert.doesNotMatch(client, /localStorage.*BETA_INVITE|BETA_INVITE.*localStorage/);
});

test("uses the configured public base path", async () => {
  process.env.VITE_BASE_PATH = "/feedback-dashboard/";
  const { default: config } = await import(`../apps/web/vite.config.mjs?pages=${Date.now()}`);
  delete process.env.VITE_BASE_PATH;

  assert.equal(config.base, "/feedback-dashboard/");
});

test("publishes a real nested OAuth consent entry for GitHub Pages", async () => {
  const { default: config } = await import(`../apps/web/vite.config.mjs?oauth=${Date.now()}`);
  const consentHtml = await readFile(
    new URL("../apps/web/oauth/consent/index.html", import.meta.url),
    "utf8",
  );

  assert.match(config.build.rollupOptions.input.main, /apps\/web\/index\.html$/);
  assert.match(
    config.build.rollupOptions.input.consent,
    /apps\/web\/oauth\/consent\/index\.html$/,
  );
  assert.match(consentHtml, /<div id="root"><\/div>/);
  assert.match(consentHtml, /src="\/src\/main\.jsx"/);
});
