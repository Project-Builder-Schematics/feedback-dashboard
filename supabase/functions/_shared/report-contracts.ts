import { z } from "zod";

export const reportStatuses = [
  "Pending",
  "Validating",
  "In construction",
  "Resolved",
  "Discarded",
] as const;

export const reportSeverities = ["Low", "Medium", "High"] as const;
export const reportTypes = ["Bug", "Improvement"] as const;

export const createReportRequestSchema = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(10_000),
  expectedBehavior: z.string().trim().min(1).max(10_000),
  reproductionSteps: z.array(z.string().trim().min(1).max(2_000)).min(1).max(50),
  severity: z.enum(reportSeverities),
  type: z.enum(reportTypes),
  platform: z.string().trim().min(1).max(200),
  appVersion: z.string().trim().min(1).max(100),
  reporterDisplayName: z.string().trim().min(1).max(200),
  reporterEmail: z.email(),
});

export const reportIssueInputSchema = createReportRequestSchema.omit({
  reporterDisplayName: true,
  reporterEmail: true,
}).strict();

export const reportResponseSchema = z.object({
  id: z.uuid(),
  publicId: z.string().regex(/^PB-\d+$/),
  status: z.enum(reportStatuses),
  submittedAt: z.iso.datetime(),
});

export const reportIssueOutputSchema = reportResponseSchema.pick({
  publicId: true,
  status: true,
  submittedAt: true,
});

export function toUtcIsoDatetime(value: unknown) {
  if (typeof value !== "string") throw new Error("Report timestamp is unavailable.");
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) throw new Error("Report timestamp is invalid.");
  return timestamp.toISOString();
}

export const attachmentUploadLinkInputSchema = z.object({
  reportId: z.string().regex(/^PB-[1-9]\d*$/),
}).strict();

export const attachmentUploadLinkOutputSchema = z.object({
  reportId: z.string().regex(/^PB-[1-9]\d*$/),
  uploadUrl: z.url(),
  expiresAt: z.iso.datetime(),
  maxFiles: z.literal(5),
});

export type CreateReportRequest = z.infer<typeof createReportRequestSchema>;
export type ReportIssueInput = z.infer<typeof reportIssueInputSchema>;
export type ReportResponse = z.infer<typeof reportResponseSchema>;
export type AttachmentUploadLinkInput = z.infer<typeof attachmentUploadLinkInputSchema>;
