# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `apps/web/src/`. Keep `apps/web/.openai/hosting.json`, `apps/web/worker/index.js`, `apps/web/scripts/prepare-sites-build.mjs`, and `apps/web/tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm --workspace apps/web run build` and `npm --workspace apps/web run test:sites`; the build must leave `apps/web/dist/client/index.html`, `apps/web/dist/server/index.js`, and `apps/web/dist/.openai/hosting.json`.

## Product Direction

- This prototype is the beta-feedback review surface for Project Builder.
- Beta testers submit reports through MCP with a description and optional screenshots, videos, and terminal traces.
- Use the selected Incident Lens mock as the layout reference and the Project Builder light/dark palette as the visual system.
- Reports move through Pending, Validating, In construction, Resolved, or Discarded. Discarded is a neutral terminal state and records a reason.
