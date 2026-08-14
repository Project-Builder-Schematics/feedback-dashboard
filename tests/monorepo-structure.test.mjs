import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("declares npm workspaces for apps and packages at the repository root", async () => {
  const manifest = JSON.parse(await readFile(new URL("./package.json", root), "utf8"));

  assert.deepEqual(manifest.workspaces, ["apps/*", "packages/*"]);
});

test("hosts the existing site inside apps/web", async () => {
  for (const path of [
    "apps/web/package.json",
    "apps/web/index.html",
    "apps/web/src/App.jsx",
    "apps/web/vite.config.mjs",
    "apps/web/tests/sites-worker.test.mjs",
    "apps/web/worker/index.js",
    "apps/web/.openai/hosting.json",
  ]) {
    await access(new URL(path, root));
  }
});
