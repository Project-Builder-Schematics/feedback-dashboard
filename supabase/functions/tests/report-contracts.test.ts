import assert from "node:assert/strict";
import test from "node:test";

import {
  createReportRequestSchema,
  reportResponseSchema,
  reportSeverities,
  reportStatuses,
  reportTypes,
} from "../_shared/report-contracts.ts";

test("exposes stable report vocabularies", () => {
  assert.deepEqual(reportStatuses, [
    "Pending",
    "Validating",
    "In construction",
    "Resolved",
    "Discarded",
  ]);
  assert.deepEqual(reportSeverities, ["Low", "Medium", "High"]);
  assert.deepEqual(reportTypes, ["Bug", "Improvement"]);
});

test("accepts a complete report payload", () => {
  const result = createReportRequestSchema.safeParse({
    title: "CLI gets stuck while creating a project",
    description: "The command never exits after the first prompt.",
    expectedBehavior: "The project should finish generating in under a minute.",
    reproductionSteps: [
      "Run the project creation command",
      "Choose the default template",
      "Wait for completion",
    ],
    severity: "High",
    type: "Bug",
    platform: "macOS 15",
    appVersion: "0.14.2-beta.3",
    reporterDisplayName: "Alex",
    reporterEmail: "alex@example.com",
  });

  assert.equal(result.success, true);
});

test("rejects invalid contract data", () => {
  const result = createReportRequestSchema.safeParse({
    title: "",
    description: "",
    reproductionSteps: [],
    severity: "Critical",
    type: "Incident",
    platform: "",
    appVersion: "",
    reporterDisplayName: "",
    reporterEmail: "not-an-email",
  });

  assert.equal(result.success, false);
  assert.match(JSON.stringify(result.error.flatten().fieldErrors), /title/);
  assert.match(JSON.stringify(result.error.flatten().fieldErrors), /severity/);
});

test("validates the API success response shape", () => {
  const result = reportResponseSchema.safeParse({
    id: "5f52c35f-8334-46b6-ac4d-8f0e52c8d5d9",
    publicId: "PB-142",
    status: "Pending",
    submittedAt: "2026-08-14T07:20:00.000Z",
  });

  assert.equal(result.success, true);
});
