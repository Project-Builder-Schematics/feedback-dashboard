import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App.jsx";

afterEach(cleanup);

describe("Project Builder feedback dashboard", () => {
  it("shows the five workflow states and the selected report", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Autocomplete freezes after malformed config" })).toBeTruthy();
    for (const state of ["Pending", "Validating", "In construction", "Resolved", "Discarded"]) {
      expect(screen.getByRole("button", { name: new RegExp(`^${state}`) })).toBeTruthy();
    }
  });

  it("presents a dense queue and an incident story the creator can scan", () => {
    render(<App />);

    const queue = screen.getByLabelText("Feedback queue");
    expect(within(queue).getAllByRole("button")).toHaveLength(5);

    const summary = screen.getByLabelText("Incident summary");
    expect(within(summary).getByText("Trigger")).toBeTruthy();
    expect(within(summary).getByText("Failure")).toBeTruthy();
    expect(within(summary).getByText("Impact")).toBeTruthy();

    for (const heading of ["Problem", "Steps to reproduce", "Evidence", "Environment", "Activity"]) {
      expect(screen.getByRole("heading", { name: heading })).toBeTruthy();
    }
  });

  it("filters the queue and selects another report", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /^Validating/ }));
    const queue = screen.getByLabelText("Feedback queue");
    expect(within(queue).getByText("CLI hangs on init with WSL path")).toBeTruthy();
    expect(within(queue).queryByText("Autocomplete freezes after malformed config")).toBeNull();

    await user.click(within(queue).getByRole("button", { name: /CLI hangs on init with WSL path/ }));
    expect(screen.getByRole("heading", { name: "CLI hangs on init with WSL path" })).toBeTruthy();
  });

  it("changes a report state and records the transition", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Change status, current Pending" }));
    await user.click(screen.getByRole("menuitem", { name: "In construction" }));

    expect(screen.getByRole("button", { name: "Change status, current In construction" })).toBeTruthy();
    expect(screen.getByText("Status changed to In construction")).toBeTruthy();
  });

  it("requires and records a reason when discarding a report", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Change status, current Pending" }));
    await user.click(screen.getByRole("menuitem", { name: "Discarded" }));

    const dialog = screen.getByRole("dialog", { name: "Discard report" });
    const confirm = within(dialog).getByRole("button", { name: "Discard report" });
    expect(confirm.disabled).toBe(true);

    await user.type(within(dialog).getByLabelText("Discard reason"), "Duplicate of PB-128");
    await user.click(confirm);

    expect(screen.getByRole("button", { name: "Change status, current Discarded" })).toBeTruthy();
    expect(screen.getByText("Duplicate of PB-128")).toBeTruthy();
  });

  it("switches between screenshot, video, and terminal evidence", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("tab", { name: "Video" }));
    expect(screen.getByText("Freeze reproduction · 00:18")).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "Terminal trace" }));
    expect(screen.getByText(/panic at src\/complete\.rs/)).toBeTruthy();
  });
});
