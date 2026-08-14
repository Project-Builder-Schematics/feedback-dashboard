import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("deploys the Vite client to GitHub Pages on pushes to main", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/deploy-pages.yml", import.meta.url),
    "utf8",
  );

  assert.match(workflow, /push:\s*\n\s*branches:\s*\[main\]/);
  assert.match(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /actions\/upload-pages-artifact@v4/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /path:\s*dist\/client/);
  assert.match(workflow, /VITE_BASE_PATH:\s*\/feedback-dashboard\//);
});

test("uses the configured public base path", async () => {
  process.env.VITE_BASE_PATH = "/feedback-dashboard/";
  const { default: config } = await import(`../vite.config.mjs?pages=${Date.now()}`);
  delete process.env.VITE_BASE_PATH;

  assert.equal(config.base, "/feedback-dashboard/");
});
