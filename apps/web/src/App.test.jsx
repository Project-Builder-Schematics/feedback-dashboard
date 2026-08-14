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
  magicLinkRedirect,
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

function createClient({
  session = null,
  reports = [],
  listError = null,
  patch,
  createInvite,
  redeem,
  authorizationDetails,
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
  const invoke = vi.fn(async (name, options) => {
    if (name === "tester-api") {
      return redeem
        ? redeem(options)
        : { data: { membership: { status: "active" } }, error: null };
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

  return {
    auth: {
      getSession: vi.fn(async () => ({ data: { session }, error: null })),
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
  };
}

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.localStorage?.clear();
  window.history.replaceState({}, "", "/");
});

describe("Project Builder creator dashboard", () => {
  it("keeps the GitHub Pages path in the magic-link redirect", () => {
    expect(
      magicLinkRedirect("/feedback-dashboard/", "https://project-builder-schematics.github.io"),
    ).toBe("https://project-builder-schematics.github.io/feedback-dashboard/");
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

  it("requests a magic link without creating unknown users and starts a client cooldown", async () => {
    const user = userEvent.setup();
    const client = createClient();
    render(<App client={client} />);

    const email = await screen.findByLabelText("Creator email");
    await user.type(email, "creator@example.com");
    await user.click(screen.getByRole("button", { name: "Send magic link" }));

    expect(client.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "creator@example.com",
      options: {
        shouldCreateUser: false,
        emailRedirectTo: new URL(import.meta.env.BASE_URL, window.location.origin).href,
      },
    });
    expect(screen.getByRole("button", { name: /Try again in 60s/ }).disabled).toBe(true);
    expect(screen.getByText(/if it has access/i)).toBeTruthy();
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
    expect(mapCreatorReport(reportDto, new Date("2026-08-14T08:20:00.000Z"))).toMatchObject({
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
    });
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

  it("clears loaded reports when the creator logs out", async () => {
    const user = userEvent.setup();
    const client = createClient({ session: { user: { id: "creator" } }, reports: [reportDto] });
    render(<App client={client} />);

    await screen.findByRole("heading", { name: reportDto.title });
    await user.click(screen.getByRole("button", { name: "Sign out" }));

    expect(client.auth.signOut).toHaveBeenCalledTimes(1);
    expect(await screen.findByLabelText("Creator email")).toBeTruthy();
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
    unmount();

    window.history.replaceState({}, "", "/feedback-dashboard/?mode=join");
    render(<App client={createClient({ session: { user: { id: "tester" } } })} />);
    expect(await screen.findByLabelText("Beta invitation code")).toBeTruthy();
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
