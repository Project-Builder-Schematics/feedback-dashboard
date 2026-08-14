import assert from "node:assert/strict";
import test from "node:test";

import { createReportIssueHandler } from "../src/index.ts";

test("maps report_issue input into the feedback API request", async () => {
  let requestedUrl = "";
  let requestedHeaders: Headers | undefined;
  let requestedBody = "";

  const handler = createReportIssueHandler({
    apiUrl: "https://bbivrybsyxpmkstomccd.supabase.co/functions/v1/feedback-api",
    betaToken: "beta-token",
    defaultReporterDisplayName: "Default Reporter",
    defaultReporterEmail: "default@example.com",
    fetch: async (input, init) => {
      requestedUrl = String(input);
      requestedHeaders = new Headers(init?.headers);
      requestedBody = String(init?.body);

      return new Response(
        JSON.stringify({
          id: "5f52c35f-8334-46b6-ac4d-8f0e52c8d5d9",
          publicId: "PB-142",
          status: "Pending",
          submittedAt: "2026-08-14T07:20:00.000Z",
        }),
        {
          status: 201,
          headers: {
            "content-type": "application/json",
          },
        },
      );
    },
  });

  const result = await handler({
    title: "CLI hangs during init",
    description: "The CLI stops after the first prompt.",
    expectedBehavior: "The CLI should finish creating the project.",
    reproductionSteps: ["Run init", "Choose default template", "Wait 60 seconds"],
    severity: "High",
    type: "Bug",
    platform: "macOS 15",
    appVersion: "0.14.2-beta.3",
  });

  assert.equal(requestedUrl, "https://bbivrybsyxpmkstomccd.supabase.co/functions/v1/feedback-api/v1/reports");
  assert.equal(requestedHeaders?.get("authorization"), "Bearer beta-token");
  assert.equal(requestedHeaders?.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(requestedBody), {
    title: "CLI hangs during init",
    description: "The CLI stops after the first prompt.",
    expectedBehavior: "The CLI should finish creating the project.",
    reproductionSteps: ["Run init", "Choose default template", "Wait 60 seconds"],
    severity: "High",
    type: "Bug",
    platform: "macOS 15",
    appVersion: "0.14.2-beta.3",
    reporterDisplayName: "Default Reporter",
    reporterEmail: "default@example.com",
  });
  assert.deepEqual(result.structuredContent, {
    publicId: "PB-142",
    status: "Pending",
    submittedAt: "2026-08-14T07:20:00.000Z",
  });
  assert.match(result.content[0]?.text ?? "", /PB-142/);
});
