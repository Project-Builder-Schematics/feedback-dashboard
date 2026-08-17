import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { App } from "./App.jsx";
import {
  BETA_INVITE_STORAGE_KEY,
  betaJoinRedirect,
  decideOAuthAuthorization,
  loadOAuthAuthorization,
  mapCreatorReport,
} from "./creator-client.js";

const reportDto = {
  id: "5f52c35f-8334-46b6-ac4d-8f0e52c8d5d9",
  publicId: "PB-142",
  title: "Project generation hangs",
  reporter_display_name: "Taylor",
  reporter_email: "taylor@example.com",
  status: "Pending",
  severity: "High",
  platform: "macOS 15",
  app_version: "0.14.2-beta.3",
  type: "Bug",
  description: "The command stops responding after the first prompt.",
  expected_behavior: "The command should finish successfully.",
  reproduction_steps: ["Run the generator", "Wait 60 seconds"],
  discard_reason: null,
  created_at: "2026-08-14T07:20:00.000Z",
  updated_at: "2026-08-14T07:20:00.000Z",
};

const imageAttachment = {
  id: "38c6c0e7-dba5-44dc-9de5-75bb728f3d12",
  fileName: "generator-hang.png",
  contentType: "image/png",
  sizeBytes: 2048,
  signedUrl: "https://storage.example/image.png?token=private",
  createdAt: "2026-08-14T07:22:00.000Z",
};

const videoAttachment = {
  id: "a0fd4532-8702-4631-b14c-df25a31c75bf",
  fileName: "generator-hang.mp4",
  contentType: "video/mp4",
  sizeBytes: 5_242_880,
  signedUrl: "https://storage.example/video.mp4?token=private",
  createdAt: "2026-08-14T07:23:00.000Z",
};

function createClient({
  session = null,
  userError = null,
  reports = [],
  listError = null,
  patch,
  createInvite,
  redeem,
  authorizationDetails,
  prepareAttachment,
  completeAttachment,
  uploadAttachment,
} = {}) {
  let authListener = () => {};
  const signInWithOtp = vi.fn(async () => ({ data: {}, error: null }));
  const signInWithOAuth = vi.fn(async () => ({ data: {}, error: null }));
  const getAuthorizationDetails = vi.fn(async () => ({
    data: authorizationDetails ?? {
      authorization_id: "authorization-123",
      redirect_uri: "http://127.0.0.1:1455/callback",
      client: { name: "Codex CLI" },
      scope: "openid email",
    },
    error: null,
  }));
  const approveAuthorization = vi.fn(async () => ({
    data: { redirect_url: "http://127.0.0.1:1455/callback?code=approved" },
    error: null,
  }));
  const denyAuthorization = vi.fn(async () => ({
    data: { redirect_url: "http://127.0.0.1:1455/callback?error=access_denied" },
    error: null,
  }));
  const signOut = vi.fn(async () => {
    authListener("SIGNED_OUT", null);
    return { error: null };
  });
  const getUser = vi.fn(async () =>
    userError
      ? { data: { user: null }, error: userError }
      : { data: { user: session?.user ?? null }, error: null }
  );
  const invoke = vi.fn(async (name, options) => {
    if (name === "attachment-upload-api") {
      return options.body.action === "prepare"
        ? prepareAttachment
          ? prepareAttachment(options)
          : {
              data: {
                attachmentId: "3ca92c31-28c7-4d65-afaf-8f5c8d91f183",
                reportId: "PB-42",
                bucket: "report-attachments",
                path: "reports/report-id/attachment-id",
                token: "signed-storage-token",
              },
              error: null,
            }
        : completeAttachment
          ? completeAttachment(options)
          : { data: { reportId: "PB-42", status: "ready" }, error: null };
    }
    if (name === "tester-api") {
      return redeem
        ? redeem(options)
        : { data: { membership: { status: "active" } }, error: null };
    }
    if (name === "beta-applications") {
      if (options.body.action === "list") {
        return {
          data: {
            applications: [{
              id: "application-1",
              email: "tester@example.com",
              status: "pending",
              created_at: "2026-08-17T05:00:00.000Z",
            }],
          },
          error: null,
        };
      }
      return { data: { application: { id: "application-1", status: options.body.action === "approve" ? "approved" : "pending" } }, error: null };
    }
    if (options.method === "GET") {
      return listError
        ? { data: null, error: new Error("load failed") }
        : { data: { reports }, error: null };
    }
    if (options.method === "POST") {
      return createInvite
        ? createInvite(options)
        : {
            data: {
              code: `pb_inv_${"A".repeat(43)}`,
              expiresAt: "2026-08-15T07:20:00.000Z",
            },
            error: null,
          };
    }
    return patch
      ? patch(options)
      : { data: { report: { ...reports[0], status: options.body.status } }, error: null };
  });

  const uploadToSignedUrl = vi.fn(
    uploadAttachment ?? (async () => ({ data: { path: "reports/report-id/attachment-id" }, error: null })),
  );

  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
      getUser,
      onAuthStateChange: vi.fn((listener) => {
        authListener = listener;
        return { data: { subscription: { unsubscribe: vi.fn() } } };
      }),
      signInWithOtp,
      signInWithOAuth,
      signOut,
      oauth: {
        getAuthorizationDetails,
        approveAuthorization,
        denyAuthorization,
      },
    },
    functions: { invoke },
    storage: {
      from: vi.fn(() => ({ uploadToSignedUrl })),
    },
  };
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.localStorage?.clear();
  window.history.replaceState({}, "", "/");
});

describe("Project Builder creator dashboard", () => {
  it("uses GitHub to apply and records the authenticated tester on confirmation", async () => {
    window.history.replaceState({}, "", "/feedback-dashboard/?mode=apply");
    const user = userEvent.setup();
    const client = createClient({ session: { user: { id: "tester" } } });
    render(<App client={client} />);

    await user.type(await screen.findByLabelText("Approval email"), "tester@example.com");
    await user.click(await screen.findByRole("button", { name: "Join the review list" }));

    expect(await screen.findByRole("heading", { name: "Application received" })).toBeTruthy();
    expect(client.functions.invoke).toHaveBeenCalledWith("beta-applications", {
      method: "POST",
      body: { action: "apply", email: "tester@example.com" },
    });
  });

  it("reviews beta applications in a dedicated dialog and keeps approval feedback attached", async () => {
    const user = userEvent.setup();
    const client = createClient({ session: { user: { id: "creator" } }, reports: [reportDto] });
    render(<App client={client} />);

    await screen.findByRole("heading", { name: reportDto.title });
    await user.click(screen.getByRole("button", { name: "Review applications" }));

    const dialog = await screen.findByRole("dialog", { name: "Beta applications" });
    expect(within(dialog).getByText("tester@example.com")).toBeTruthy();
    expect(within(dialog).getByText("Pending review")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Approve tester@example.com" }));
    expect(await within(dialog).findByText("Approved · Email sent")).toBeTruthy();
  });

  it("keeps the join mode in the exact GitHub OAuth redirect", () => {
    expect(betaJoinRedirect("/wrong-path/", "http://localhost:5173")).toBe(
      "https://project-builder-schematics.github.io/feedback-dashboard/?mode=join",
    );
  });

  it("loads and decides an OAuth authorization through Supabase Auth", async () => {
    const client = createClient();

    await expect(loadOAuthAuthorization(client, "authorization-123")).resolves.toMatchObject({
      authorization_id: "authorization-123",
      client: { name: "Codex CLI" },
    });
    await expect(
      decideOAuthAuthorization(client, "authorization-123", "approve"),
    ).resolves.toBe("http://127.0.0.1:1455/callback?code=approved");

    expect(client.auth.oauth.getAuthorizationDetails).toHaveBeenCalledWith("authorization-123");
    expect(client.auth.oauth.approveAuthorization).toHaveBeenCalledWith("authorization-123", {
      skipBrowserRedirect: true,
    });
    expect(client.auth.oauth.denyAuthorization).not.toHaveBeenCalled();
  });

  it("keeps the OAuth authorization request when GitHub sign-in is required", async () => {
    window.history.replaceState(
      {},
      "",
      "/feedback-dashboard/oauth/consent/?authorization_id=authorization-123",
    );
    const user = userEvent.setup();
    const client = createClient();
    render(<App client={client} />);

    await user.click(await screen.findByRole("button", { name: "Continue with GitHub" }));

    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "github",
      options: {
        redirectTo:
          "http://localhost:3000/feedback-dashboard/oauth/consent/?authorization_id=authorization-123",
      },
    });
    expect(client.functions.invoke).not.toHaveBeenCalled();
  });

  it("shows the requesting MCP client without loading creator feedback", async () => {
    window.history.replaceState(
      {},
      "",
      "/feedback-dashboard/oauth/consent/?authorization_id=authorization-123",
    );
    const client = createClient({ session: { user: { id: "tester" } } });
    render(<App client={client} />);

    expect(await screen.findByRole("heading", { name: "Authorize Codex CLI" })).toBeTruthy();
    expect(screen.getByText("openid")).toBeTruthy();
    expect(screen.getByText("email")).toBeTruthy();
    expect(screen.getByText("http://127.0.0.1:1455/callback")).toBeTruthy();
    expect(client.auth.oauth.getAuthorizationDetails).toHaveBeenCalledWith("authorization-123");
    expect(client.functions.invoke).not.toHaveBeenCalled();
  });

  it("clears a stale deleted-user session before loading MCP authorization", async () => {
    window.history.replaceState(
      {},
      "",
      "/feedback-dashboard/oauth/consent/?authorization_id=authorization-123",
    );
    const client = createClient({
      session: { user: { id: "deleted-tester" } },
      userError: { status: 403, code: "bad_jwt", message: "User from sub claim in JWT does not exist" },
    });
    render(<App client={client} />);

    expect(await screen.findByRole("button", { name: "Continue with GitHub" })).toBeTruthy();
    expect(client.auth.getUser).toHaveBeenCalledTimes(1);
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(client.auth.oauth.getAuthorizationDetails).not.toHaveBeenCalled();
  });

  it("starts creator GitHub sign-in with the exact dashboard redirect", async () => {
    const user = userEvent.setup();
    const client = createClient();
    render(<App client={client} />);

    await user.click(await screen.findByRole("button", { name: "Continue with GitHub" }));

    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "github",
      options: {
        redirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).href,
      },
    });
    expect(client.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("explains that GitHub identity does not grant creator access by itself", async () => {
    render(<App client={createClient()} />);

    expect(await screen.findByRole("heading", { name: "Creator sign in" })).toBeTruthy();
    expect(screen.getByText(/approved creator accounts/i)).toBeTruthy();
    expect(screen.queryByLabelText("Creator email")).toBeNull();
  });

  it("shows session loading, empty, and load-error states", async () => {
    const emptyClient = createClient({ session: { user: { id: "creator" } } });
    const { unmount } = render(<App client={emptyClient} />);

    expect(screen.getByText("Checking creator access…")).toBeTruthy();
    expect(await screen.findByText("No feedback reports yet")).toBeTruthy();
    unmount();

    render(
      <App
        client={createClient({
          session: { user: { id: "creator" } },
          listError: new Error("load failed"),
        })}
      />,
    );
    expect(await screen.findByText("Feedback could not be loaded.")).toBeTruthy();
  });

  it("maps the real API DTO without inventing incident or evidence fields", () => {
    expect(mapCreatorReport(
      { ...reportDto, attachments: [imageAttachment] },
      new Date("2026-08-14T08:20:00.000Z"),
    )).toMatchObject({
      reportId: reportDto.id,
      id: "PB-142",
      tester: "Taylor",
      email: "taylor@example.com",
      version: "0.14.2-beta.3",
      problem: reportDto.description,
      expected: reportDto.expected_behavior,
      steps: reportDto.reproduction_steps,
      trigger: "Not provided",
      failure: "Not provided",
      impact: "Not provided",
      age: "1h",
      attachments: [imageAttachment],
    });
  });

  it("renders private image and video evidence linked to the selected report", async () => {
    render(
      <App
        client={createClient({
          session: { user: { id: "creator" } },
          reports: [{ ...reportDto, attachments: [imageAttachment, videoAttachment] }],
        })}
      />,
    );

    await screen.findByRole("heading", { name: reportDto.title });

    const imageLink = screen.getByRole("link", { name: "Preview generator-hang.png" });
    expect(imageLink.getAttribute("href")).toBe(imageAttachment.signedUrl);
    expect(imageLink.getAttribute("rel")).toContain("noreferrer");
    expect(screen.getByRole("img", { name: "generator-hang.png" }).getAttribute("src")).toBe(
      imageAttachment.signedUrl,
    );
    expect(screen.getByLabelText("Video: generator-hang.mp4").getAttribute("src")).toBe(
      videoAttachment.signedUrl,
    );
    expect(screen.getByText("2 KB")).toBeTruthy();
    expect(screen.getByText("5 MB")).toBeTruthy();
    expect(screen.queryByText("No evidence was submitted with this report.")).toBeNull();
  });

  it("loads real reports without presenting demo evidence or history as durable", async () => {
    render(
      <App client={createClient({ session: { user: { id: "creator" } }, reports: [reportDto] })} />,
    );

    expect(await screen.findByRole("heading", { name: reportDto.title })).toBeTruthy();
    const summary = screen.getByLabelText("Incident summary");
    expect(within(summary).getAllByText("Not provided")).toHaveLength(3);
    expect(screen.queryByText("Evidence processed")).toBeNull();
    expect(screen.queryByText("zsh 5.9")).toBeNull();
    expect(screen.getByText("No evidence was submitted with this report.")).toBeTruthy();
    expect(screen.getByText("No durable activity is available yet.")).toBeTruthy();
  });

  it("focuses the global search from the advertised keyboard shortcut", async () => {
    const user = userEvent.setup();
    render(<App client={createClient({ session: { user: { id: "creator" } }, reports: [reportDto] })} />);

    await screen.findByRole("heading", { name: reportDto.title });
    await user.keyboard("{Control>}k{/Control}");

    expect(document.activeElement).toBe(screen.getByPlaceholderText("Search feedback, testers, versions…"));
  });

  it("does not show a report from another status when the active queue is empty", async () => {
    const user = userEvent.setup();
    render(<App client={createClient({ session: { user: { id: "creator" } }, reports: [reportDto] })} />);

    await screen.findByRole("heading", { name: reportDto.title });
    await user.click(screen.getByRole("button", { name: "Resolved 0 reports" }));

    expect(screen.getByText("No reports in Resolved")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: reportDto.title })).toBeNull();
  });

  it("supports the mobile queue-to-detail navigation model", async () => {
    const user = userEvent.setup();
    render(<App client={createClient({ session: { user: { id: "creator" } }, reports: [reportDto] })} />);

    await screen.findByRole("heading", { name: reportDto.title });
    const workspace = document.querySelector(".workspace");
    await user.click(screen.getByRole("button", { name: `${reportDto.title}, High severity` }));
    expect(workspace.className).toContain("show-detail");

    await user.click(screen.getByRole("button", { name: "Back to queue" }));
    expect(workspace.className).toContain("show-queue");
  });

  it("clears loaded reports when the creator logs out", async () => {
    const user = userEvent.setup();
    const client = createClient({ session: { user: { id: "creator" } }, reports: [reportDto] });
    render(<App client={client} />);

    await screen.findByRole("heading", { name: reportDto.title });
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Continue with GitHub" })).toBeTruthy();
    expect(screen.queryByText(reportDto.title)).toBeNull();
  });

  it("applies only the server-authoritative status response", async () => {
    const user = userEvent.setup();
    let resolvePatch;
    const patchPromise = new Promise((resolve) => {
      resolvePatch = resolve;
    });
    const client = createClient({
      session: { user: { id: "creator" } },
      reports: [reportDto],
      patch: () => patchPromise,
    });
    render(<App client={client} />);

    await screen.findByRole("heading", { name: reportDto.title });
    await user.click(screen.getByRole("button", { name: "Change status, current Pending" }));
    await user.click(screen.getByRole("menuitem", { name: "In construction" }));

    expect(screen.getByRole("button", { name: "Change status, current Pending" })).toBeTruthy();
    resolvePatch({ data: { report: { ...reportDto, status: "Validating" } }, error: null });

    expect(
      await screen.findByRole("button", { name: "Change status, current Validating" }),
    ).toBeTruthy();
    expect(client.functions.invoke).toHaveBeenLastCalledWith("creator-api", {
      method: "PATCH",
      body: { reportId: reportDto.id, status: "In construction" },
    });
  });

  it("retains the previous state and discard reason when PATCH fails", async () => {
    const user = userEvent.setup();
    const client = createClient({
      session: { user: { id: "creator" } },
      reports: [reportDto],
      patch: async () => ({ data: null, error: new Error("patch failed") }),
    });
    render(<App client={client} />);

    await screen.findByRole("heading", { name: reportDto.title });
    await user.click(screen.getByRole("button", { name: "Change status, current Pending" }));
    await user.click(screen.getByRole("menuitem", { name: "Discarded" }));
    const dialog = screen.getByRole("dialog", { name: "Discard report" });
    await user.type(within(dialog).getByLabelText("Discard reason"), "Duplicate report");
    await user.click(within(dialog).getByRole("button", { name: "Discard report" }));

    expect(await screen.findByText("Status could not be saved.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Change status, current Pending" })).toBeTruthy();
    expect(screen.getByLabelText("Discard reason").value).toBe("Duplicate report");
  });

  it("hands an invite to GitHub OAuth through sessionStorage only", async () => {
    window.history.replaceState({}, "", "/feedback-dashboard/?mode=join");
    const user = userEvent.setup();
    const client = createClient();
    render(<App client={client} />);

    const input = await screen.findByLabelText("Beta invitation code");
    await user.type(input, `pb_inv_${"A".repeat(43)}`);
    await user.click(screen.getByRole("button", { name: "Continue with GitHub" }));

    expect(window.sessionStorage.getItem(BETA_INVITE_STORAGE_KEY)).toBe(
      `pb_inv_${"A".repeat(43)}`,
    );
    expect(window.localStorage?.getItem(BETA_INVITE_STORAGE_KEY) ?? null).toBeNull();
    expect(client.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "github",
      options: {
        redirectTo: "https://project-builder-schematics.github.io/feedback-dashboard/?mode=join",
      },
    });
  });

  it("sets expectations for the beta onboarding handoff", async () => {
    window.history.replaceState({}, "", "/feedback-dashboard/?mode=join");
    render(<App client={createClient()} />);

    expect(
      await screen.findByRole("heading", { name: "Join the Project Builder beta" }),
    ).toBeTruthy();
    expect(screen.getByText(/you'll return here automatically/i)).toBeTruthy();
    expect(screen.getByText(/one-time invitation/i)).toBeTruthy();
  });

  it("removes a pending invite and OAuth error material even without a session", async () => {
    const invite = `pb_inv_${"D".repeat(43)}`;
    window.sessionStorage.setItem(BETA_INVITE_STORAGE_KEY, invite);
    window.history.replaceState(
      {},
      "",
      "/feedback-dashboard/?mode=join#error=access_denied&error_code=provider_error",
    );
    const client = createClient();
    render(<App client={client} />);

    expect(
      await screen.findByRole("heading", { name: "Invitation could not be redeemed" }),
    ).toBeTruthy();
    expect(window.sessionStorage.getItem(BETA_INVITE_STORAGE_KEY)).toBeNull();
    expect(window.location.search).toBe("?mode=join");
    expect(window.location.hash).toBe("");
    expect(client.functions.invoke).not.toHaveBeenCalledWith(
      "tester-api",
      expect.anything(),
    );
  });

  it("does not clear a pending invite on an ordinary join-page load", async () => {
    const invite = `pb_inv_${"E".repeat(43)}`;
    window.sessionStorage.setItem(BETA_INVITE_STORAGE_KEY, invite);
    window.history.replaceState({}, "", "/feedback-dashboard/?mode=join");
    const client = createClient();
    render(<App client={client} />);

    expect(await screen.findByLabelText("Beta invitation code")).toBeTruthy();
    expect(window.sessionStorage.getItem(BETA_INVITE_STORAGE_KEY)).toBe(invite);
    expect(client.functions.invoke).not.toHaveBeenCalledWith(
      "tester-api",
      expect.anything(),
    );
  });

  it("redeems a pending invite after PKCE has consumed the callback code", async () => {
    const invite = `pb_inv_${"F".repeat(43)}`;
    window.sessionStorage.setItem(BETA_INVITE_STORAGE_KEY, invite);
    window.history.replaceState({}, "", "/feedback-dashboard/?mode=join");
    const client = createClient({ session: { user: { id: "tester" } } });
    render(<App client={client} />);

    expect(await screen.findByRole("heading", { name: "Beta access activated" })).toBeTruthy();
    expect(screen.getByText(/return to your MCP client/i)).toBeTruthy();
    expect(window.sessionStorage.getItem(BETA_INVITE_STORAGE_KEY)).toBeNull();
    expect(client.functions.invoke).toHaveBeenCalledWith("tester-api", {
      method: "POST",
      body: { code: invite },
    });
  });

  it("removes the pending invite and OAuth URL material before activating membership", async () => {
    const invite = `pb_inv_${"B".repeat(43)}`;
    window.sessionStorage.setItem(BETA_INVITE_STORAGE_KEY, invite);
    window.history.replaceState(
      {},
      "",
      "/feedback-dashboard/?mode=join&code=oauth-code#provider-token",
    );
    const client = createClient({ session: { user: { id: "tester" } } });
    render(<App client={client} />);

    expect(await screen.findByRole("heading", { name: "Beta access activated" })).toBeTruthy();
    expect(window.sessionStorage.getItem(BETA_INVITE_STORAGE_KEY)).toBeNull();
    expect(window.location.search).toBe("?mode=join");
    expect(window.location.hash).toBe("");
    expect(client.functions.invoke).toHaveBeenCalledWith("tester-api", {
      method: "POST",
      body: { code: invite },
    });
  });

  it("shows one generic onboarding failure and returns to the join form without a pending invite", async () => {
    window.sessionStorage.setItem(BETA_INVITE_STORAGE_KEY, `pb_inv_${"C".repeat(43)}`);
    window.history.replaceState({}, "", "/feedback-dashboard/?mode=join&code=oauth-code");
    const client = createClient({
      session: { user: { id: "tester" } },
      redeem: async () => ({ data: null, error: new Error("expired invitation details") }),
    });
    const { unmount } = render(<App client={client} />);

    expect(await screen.findByRole("heading", { name: "Invitation could not be redeemed" })).toBeTruthy();
    expect(screen.queryByText(/expired invitation details/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Try another invitation" })).toBeTruthy();
    unmount();

    window.history.replaceState({}, "", "/feedback-dashboard/?mode=join");
    render(<App client={createClient({ session: { user: { id: "tester" } } })} />);
    expect(await screen.findByLabelText("Beta invitation code")).toBeTruthy();
  });

  it("moves an upload capability out of the URL before showing the attachment screen", async () => {
    const capability = `pb_upload_${"A".repeat(43)}`;
    window.history.replaceState(
      {},
      "",
      `/feedback-dashboard/?mode=upload#${capability}`,
    );
    render(<App client={createClient()} />);

    expect(
      await screen.findByRole("heading", { name: "Add evidence to your report" }),
    ).toBeTruthy();
    expect(window.location.hash).toBe("");
    expect(window.sessionStorage.getItem("project-builder-upload-capability")).toBe(capability);
    expect(document.body.textContent).not.toContain(capability);
    const input = screen.getByLabelText("Images or videos");
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe("image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime");
  });

  it("rejects unsupported, oversized, and excessive attachment selections before upload", async () => {
    window.history.replaceState(
      {},
      "",
      `/feedback-dashboard/?mode=upload#pb_upload_${"B".repeat(43)}`,
    );
    const user = userEvent.setup({ applyAccept: false });
    const client = createClient();
    render(<App client={client} />);
    const input = await screen.findByLabelText("Images or videos");
    const unsupported = new File(["notes"], "notes.pdf", { type: "application/pdf" });
    const oversized = new File(["video"], "large.mp4", { type: "video/mp4" });
    Object.defineProperty(oversized, "size", { value: 50 * 1024 * 1024 + 1 });

    await user.upload(input, [unsupported, oversized]);

    expect(screen.getByText("notes.pdf").closest("li")?.textContent).toMatch(/not supported/i);
    expect(screen.getByText("large.mp4").closest("li")?.textContent).toMatch(/50 MiB/i);
    expect(screen.getByRole("button", { name: "Upload 2 files" }).disabled).toBe(true);
    expect(client.functions.invoke).not.toHaveBeenCalledWith(
      "attachment-upload-api",
      expect.anything(),
    );

    const sixImages = Array.from(
      { length: 6 },
      (_, index) => new File(["image"], `screen-${index}.png`, { type: "image/png" }),
    );
    await user.upload(input, sixImages);
    expect(screen.getByRole("alert").textContent).toMatch(/up to 5 files/i);
  });

  it("uploads selected files through signed URLs and clears the capability after completion", async () => {
    const capability = `pb_upload_${"C".repeat(43)}`;
    window.history.replaceState(
      {},
      "",
      `/feedback-dashboard/?mode=upload#${capability}`,
    );
    const user = userEvent.setup();
    const client = createClient();
    render(<App client={client} />);
    const input = await screen.findByLabelText("Images or videos");
    const image = new File(["image"], "broken-screen.png", { type: "image/png" });

    await user.upload(input, image);
    await user.click(screen.getByRole("button", { name: "Upload 1 file" }));

    expect(await screen.findByRole("heading", { name: "Evidence attached" })).toBeTruthy();
    expect(screen.getByText(/PB-42/)).toBeTruthy();
    expect(window.sessionStorage.getItem("project-builder-upload-capability")).toBeNull();
    expect(client.functions.invoke).toHaveBeenNthCalledWith(1, "attachment-upload-api", {
      method: "POST",
      headers: { Authorization: `Bearer ${capability}` },
      body: {
        action: "prepare",
        fileName: "broken-screen.png",
        contentType: "image/png",
        sizeBytes: image.size,
      },
    });
    expect(client.storage.from).toHaveBeenCalledWith("report-attachments");
    expect(client.storage.from().uploadToSignedUrl).toHaveBeenCalledWith(
      "reports/report-id/attachment-id",
      "signed-storage-token",
      image,
      { contentType: "image/png" },
    );
    expect(client.functions.invoke).toHaveBeenNthCalledWith(2, "attachment-upload-api", {
      method: "POST",
      headers: { Authorization: `Bearer ${capability}` },
      body: {
        action: "complete",
        attachmentId: "3ca92c31-28c7-4d65-afaf-8f5c8d91f183",
      },
    });
  });

  it("keeps a failed file visible and retains the capability for recovery", async () => {
    const capability = `pb_upload_${"D".repeat(43)}`;
    window.history.replaceState(
      {},
      "",
      `/feedback-dashboard/?mode=upload#${capability}`,
    );
    const user = userEvent.setup();
    const client = createClient({
      uploadAttachment: async () => ({ data: null, error: new Error("storage details") }),
    });
    render(<App client={client} />);
    const input = await screen.findByLabelText("Images or videos");

    await user.upload(input, new File(["image"], "broken.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "Upload 1 file" }));

    expect(await screen.findByText("Upload failed")).toBeTruthy();
    expect(screen.queryByText(/storage details/i)).toBeNull();
    expect(window.sessionStorage.getItem("project-builder-upload-capability")).toBe(capability);
  });

  it("lets the creator create and explicitly copy a one-time 24-hour invitation", async () => {
    const user = userEvent.setup();
    const client = createClient({
      session: { user: { id: "creator", email: "creator@example.com" } },
      reports: [reportDto],
    });
    render(<App client={client} />);

    await screen.findByRole("heading", { name: reportDto.title });
    await user.click(screen.getByRole("button", { name: "Create beta invite" }));
    const code = `pb_inv_${"A".repeat(43)}`;
    expect(await screen.findByText(code)).toBeTruthy();
    expect(screen.getByText(/expires in 24 hours/i)).toBeTruthy();
    const writeText = vi.spyOn(window.navigator.clipboard, "writeText");
    await user.click(screen.getByRole("button", { name: "Copy invitation code" }));

    expect(writeText).toHaveBeenCalledWith(code);
    expect(client.functions.invoke).toHaveBeenCalledWith("creator-api", {
      method: "POST",
      body: { action: "create_beta_invite" },
    });
  });
});
