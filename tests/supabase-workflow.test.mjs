import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("deploys migrations and Edge Functions safely on relevant pushes to main", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/deploy-supabase.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/);
  assert.match(workflow, /paths:\s*\n\s*- "supabase\/\*\*"/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.match(workflow, /concurrency:\s*\n\s*group:\s*supabase-production/);
  assert.match(workflow, /cancel-in-progress:\s*false/);
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
  assert.match(workflow, /SUPABASE_ACCESS_TOKEN:\s*\$\{\{\s*secrets\.SUPABASE_ACCESS_TOKEN\s*\}\}/);
  assert.match(workflow, /SUPABASE_DB_PASSWORD:\s*\$\{\{\s*secrets\.SUPABASE_DB_PASSWORD\s*\}\}/);
  assert.match(workflow, /SUPABASE_PROJECT_ID:\s*\$\{\{\s*vars\.SUPABASE_PROJECT_ID\s*\}\}/);
  assert.match(workflow, /uses:\s*actions\/checkout@d23441a48e516b6c34aea4fa41551a30e30af803/);
  assert.match(workflow, /uses:\s*supabase\/setup-cli@ab058987d8d6c725971f6cf9d0b5c98467e30bd1/);
  assert.match(workflow, /version:\s*2\.114\.0/);
  assert.match(workflow, /supabase link --project-ref "\$SUPABASE_PROJECT_ID"/);
  assert.match(workflow, /supabase db push/);
  assert.match(workflow, /https:\/\/api\.supabase\.com\/v1\/projects\/\$\{SUPABASE_PROJECT_ID\}\/config\/auth/);
  assert.match(workflow, /--request PATCH/);
  assert.match(workflow, /--data @supabase\/auth-production\.json/);
  assert.doesNotMatch(workflow, /supabase config push/);
  assert.match(
    workflow,
    /supabase functions deploy feedback-api --project-ref "\$SUPABASE_PROJECT_ID" --no-verify-jwt/,
  );
  assert.match(workflow, /supabase functions deploy creator-api --project-ref "\$SUPABASE_PROJECT_ID"/);
  assert.match(workflow, /supabase functions deploy tester-api --project-ref "\$SUPABASE_PROJECT_ID"/);
  assert.match(
    workflow,
    /supabase functions deploy project-builder-mcp --project-ref "\$SUPABASE_PROJECT_ID" --no-verify-jwt/,
  );
  assert.doesNotMatch(workflow, /ENABLE_CREATOR_API/);
  assert.doesNotMatch(workflow, /creator-api[^\n]*--no-verify-jwt|tester-api[^\n]*--no-verify-jwt/);
  assert.doesNotMatch(workflow, /supabase secrets set|PB_CREATOR_USER_IDS|PB_ALLOWED_ORIGINS|PB_FEEDBACK_TOKEN/);

  const link = workflow.indexOf('supabase link --project-ref "$SUPABASE_PROJECT_ID"');
  const migrations = workflow.indexOf("supabase db push");
  const feedback = workflow.indexOf("supabase functions deploy feedback-api");
  const creator = workflow.indexOf("supabase functions deploy creator-api");
  const tester = workflow.indexOf("supabase functions deploy tester-api");
  const config = workflow.indexOf("api.supabase.com/v1/projects/");
  const mcp = workflow.indexOf("supabase functions deploy project-builder-mcp");

  assert.ok(
    link < migrations &&
      migrations < config &&
      config < feedback &&
      feedback < creator &&
      creator < tester &&
      tester < mcp,
  );
});
