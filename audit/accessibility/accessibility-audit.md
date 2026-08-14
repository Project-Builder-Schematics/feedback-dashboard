# Accessibility audit

Date: 2026-08-14

Surface: Project Builder Feedback dashboard and primary triage flow

Target: practical WCAG 2.2 AA readiness for keyboard, screen-reader semantics, contrast, modal/menu behavior, and responsive reflow

## Executive summary

The dashboard has a solid accessible foundation: clear landmarks, native buttons, visible focus, labeled form controls, semantic evidence tabs, and responsive reflow without horizontal scrolling. It is not ready for a WCAG AA conformance claim. The audit found three high-impact issues and five moderate issues, concentrated in low-contrast secondary text, missing accessible state, and incomplete keyboard behavior for composite widgets.

## Prioritized findings

### P1 — Quiet text does not meet normal-text contrast

`--quiet` resolves to a 3.25:1 contrast ratio on the light background and 3.43:1 in the dark theme. It is used widely at 8–10px for timestamps, labels, hints, and menu text. This is below the 4.5:1 threshold for normal text and affects both themes.

- Relevant consideration: WCAG 1.4.3 Contrast (Minimum).
- Recommendation: raise `--quiet` contrast to at least 4.5:1 against every surface where it appears. Keep disabled controls visually distinct, but do not reuse the disabled color for readable metadata.
- Evidence: [overview](01-overview.png), [dark theme](06-dark-theme.png).

### P1 — Search purpose is not exposed correctly

The search field has no explicit accessible name. In the accessibility tree its computed name is `⌘ K`, inherited from the visible keyboard-hint content in the wrapping label, rather than “Search feedback”. The placeholder communicates purpose visually but is not a robust label.

- Relevant consideration: WCAG 3.3.2 Labels or Instructions and 4.1.2 Name, Role, Value.
- Recommendation: add a persistent or visually hidden label, or an explicit `aria-label="Search feedback"`; keep the shortcut hint out of the label computation.

### P1 — Status changes are not announced

Changing status, assigning an owner, or requesting details updates the activity timeline visually, but there is no live region. A screen-reader user receives no confirmation that the action completed.

- Relevant consideration: WCAG 4.1.3 Status Messages.
- Recommendation: expose a concise `role="status"` or `aria-live="polite"` confirmation. Do not announce the entire timeline on every update.

### P2 — Status menu is missing menu-button behavior

The status trigger does not expose `aria-haspopup` or `aria-expanded`. Opening it leaves focus on the trigger instead of moving to an item, and Escape did not close the menu during keyboard testing.

- Relevant consideration: WCAG 2.1.1 Keyboard, 2.4.3 Focus Order, and 4.1.2 Name, Role, Value.
- Recommendation: implement a complete menu-button pattern: expanded state, focus entry, arrow-key navigation, Escape close, outside-click close, and focus restoration.
- Evidence: [status menu](03-status-menu.png).

### P2 — Discard dialog has incomplete keyboard behavior

The dialog correctly exposes `role="dialog"`, `aria-modal="true"`, and moves initial focus to the reason field. Escape did not close it. The large X-circle is styled like a close control but is a non-interactive `span`, creating a false affordance. Focus containment could not be conclusively verified in the browser harness and should be tested with VoiceOver and a physical keyboard.

- Relevant consideration: WCAG 2.1.1 Keyboard and 2.4.3 Focus Order.
- Recommendation: add Escape handling, a real close button with an accessible name, explicit focus trapping/inert background behavior, and restoration to the status trigger.
- Evidence: [discard dialog](04-discard-dialog.png).

### P2 — Visual selection is not exposed for filters and reports

The active status filter and selected report are conveyed through styling only. Their buttons expose neither `aria-pressed`, `aria-current`, nor another programmatic selected state.

- Relevant consideration: WCAG 1.3.1 Info and Relationships and 4.1.2 Name, Role, Value.
- Recommendation: use `aria-pressed` for filter toggles and `aria-current` or a listbox/option pattern for the selected report, depending on the intended interaction model.

### P2 — Evidence tabs do not follow the expected keyboard model

All three tabs remain in the page tab order and no arrow-key behavior is implemented. A conventional ARIA tab set keeps only the active tab at `tabIndex=0`, uses `tabIndex=-1` for inactive tabs, and supports Left/Right arrow movement.

- Relevant consideration: WCAG 2.1.1 Keyboard and 4.1.2 Name, Role, Value.
- Recommendation: add roving tab index, arrow navigation, `aria-controls`, panel IDs, and focus behavior consistent with the chosen activation model.

### P2 — One interactive target is below 24px tall

The “Expand” control for the terminal trace measured 64×22px. The search input itself measured 18px tall, although its surrounding label provides a larger clickable area.

- Relevant consideration: WCAG 2.5.8 Target Size (Minimum).
- Recommendation: give the “Expand” control a minimum 24×24px hit area, preferably 32px for this dense desktop UI.

## What is already working well

- Keyboard focus is clearly visible with a 3px accent outline.
- The page uses meaningful `banner`, `main`, `complementary`, `article`, section, list, and definition-list semantics.
- Severity is communicated with text as well as color.
- The dialog has a programmatic title, labeled textarea, and useful initial focus.
- Primary, muted, and accent text colors passed the sampled contrast checks.
- The 390×844 mobile layout reflows without horizontal overflow.

## Audited flow

1. **Dashboard overview — Healthy with contrast exceptions.** The information hierarchy and landmark structure are clear. Quiet metadata is difficult to read.
   - Screenshot: [01-overview.png](01-overview.png)
2. **Keyboard focus — Healthy.** Focus is visible and not obscured on the tested brand link.
   - Screenshot: [02-keyboard-focus.png](02-keyboard-focus.png)
3. **Status menu — Needs work.** The menu is visually clear but lacks required state and keyboard behavior.
   - Screenshot: [03-status-menu.png](03-status-menu.png)
4. **Discard flow — Needs work.** Initial focus and labeling are good; Escape, close affordance, and focus containment need attention.
   - Screenshot: [04-discard-dialog.png](04-discard-dialog.png)
5. **Mobile reflow — Healthy.** No horizontal scrolling at 390px; primary content remains readable.
   - Screenshot: [05-mobile-reflow.png](05-mobile-reflow.png)
6. **Dark theme — Needs contrast adjustment.** Core content remains legible, but quiet labels are below normal-text contrast requirements.
   - Screenshot: [06-dark-theme.png](06-dark-theme.png)

## Limitations

This is a focused product audit, not a formal WCAG conformance evaluation. It did not include a full VoiceOver session, Windows screen readers, speech input, forced-colors mode, reduced-motion verification, browser zoom to 200–400%, or every possible report state. Focus containment in the modal also needs confirmation with a physical keyboard and assistive technology.

## Recommended fix order

1. Correct the quiet text tokens and the search field accessible name.
2. Add live status confirmation for report actions.
3. Complete menu and dialog keyboard/focus behavior.
4. Expose selected filter/report state and complete the tab keyboard pattern.
5. Increase the terminal “Expand” hit area and run a manual VoiceOver regression pass.
