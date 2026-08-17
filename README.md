# Project Builder Feedback

The private review dashboard and MCP feedback service for the Project Builder beta.

## Production access

- Creator dashboard: <https://project-builder-schematics.github.io/feedback-dashboard/>
- Beta application: <https://project-builder-schematics.github.io/feedback-dashboard/?mode=apply>
- Redeem an invitation: <https://project-builder-schematics.github.io/feedback-dashboard/?mode=join>
- OAuth consent: <https://project-builder-schematics.github.io/feedback-dashboard/oauth/consent/>
- Attachment upload: `/?mode=upload` (requires a short-lived capability in the URL fragment)

Creator access and beta membership are verified by Supabase Auth with GitHub identities. Do not share creator accounts, invitation codes, or upload capabilities.

## Services

- `creator-api` lists reports, updates their status, and creates one-time invitations.
- `tester-api` redeems invitations.
- `beta-applications` records and reviews beta applications.
- `project-builder-mcp` is the remote MCP endpoint used by approved testers.

Approval email is sent as `Project Builder <beta@pbuilder.dev>` through Resend. Configure `RESEND_API_KEY` and `PB_BETA_FROM_EMAIL` as Supabase secrets; never expose them to the web application.
