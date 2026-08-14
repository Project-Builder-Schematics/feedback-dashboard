import { startProjectBuilderFeedbackMcpServer } from "./index.ts";

function requiredEnvironmentVariable(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

await startProjectBuilderFeedbackMcpServer({
  apiUrl: requiredEnvironmentVariable("PB_FEEDBACK_API_URL"),
  betaToken: requiredEnvironmentVariable("PB_FEEDBACK_TOKEN"),
  defaultReporterDisplayName: requiredEnvironmentVariable("PB_REPORTER_DISPLAY_NAME"),
  defaultReporterEmail: requiredEnvironmentVariable("PB_REPORTER_EMAIL"),
});
