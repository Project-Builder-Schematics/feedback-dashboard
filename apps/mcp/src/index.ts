import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import {
  reportIssueInputSchema,
  reportIssueOutputSchema,
  reportResponseSchema,
  type CreateReportRequest,
  type ReportIssueInput,
} from "../../../supabase/functions/_shared/report-contracts.ts";

interface ReportIssueHandlerOptions {
  apiUrl: string;
  betaToken: string;
  defaultReporterDisplayName: string;
  defaultReporterEmail: string;
  fetch?: typeof fetch;
}

export function createReportIssueHandler(options: ReportIssueHandlerOptions) {
  const request = options.fetch ?? fetch;

  return async (input: ReportIssueInput) => {
    const payload: CreateReportRequest = {
      ...reportIssueInputSchema.parse(input),
      reporterDisplayName: options.defaultReporterDisplayName,
      reporterEmail: options.defaultReporterEmail,
    };
    const response = await request(`${options.apiUrl.replace(/\/$/, "")}/v1/reports`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.betaToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Feedback API rejected the report with status ${response.status}.`);
    }

    const report = reportResponseSchema.parse(await response.json());
    const structuredContent = reportIssueOutputSchema.parse(report);

    return {
      content: [
        {
          type: "text" as const,
          text: `Issue ${report.publicId} was submitted with status ${report.status}.`,
        },
      ],
      structuredContent,
    };
  };
}

export function createProjectBuilderFeedbackMcpServer(options: ReportIssueHandlerOptions) {
  const server = new McpServer({
    name: "project-builder-feedback",
    version: "0.1.0",
  });
  const reportIssue = createReportIssueHandler(options);

  server.registerTool(
    "report_issue",
    {
      title: "Report a Project Builder issue",
      description: "Submit a bug or improvement report from a Project Builder beta test.",
      inputSchema: reportIssueInputSchema,
      outputSchema: reportIssueOutputSchema,
    },
    reportIssue,
  );

  return server;
}

export async function startProjectBuilderFeedbackMcpServer(options: ReportIssueHandlerOptions) {
  const server = createProjectBuilderFeedbackMcpServer(options);
  await server.connect(new StdioServerTransport());
  return server;
}
