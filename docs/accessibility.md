# Accessibility (RFP 5.1, 5.2)

Target: **WCAG 2.2 level AA** for the console and for the UI the SDKs draw.

## Internal automated audit (2026-09-24)

Every console page was scanned with axe-core 4.10 (rule sets `wcag2a`, `wcag2aa`, `wcag21a`,
`wcag21aa`, `wcag22aa`): Overview, Contacts, Segments, Templates, Content, Campaigns, New campaign,
Journeys, Calendar, Logs, Account and Settings.

| Before | Fix | After |
| --- | --- | --- |
| 96 × text contrast below 4.5:1 (faint grey, vermillion accent, green badges) | design tokens darkened in `src/app/globals.css`, so each passes 4.5:1 on every surface | 0 |
| 9 × form controls without an accessible name (selects, file inputs, filters) | `aria-label` / wrapping `<label>` | 0 |
| 1 × scrollable audit log unreachable by keyboard | focusable `role="region"` with a name | 0 |
| 2 × checkboxes under the 24 px target size | larger checkboxes and radios site-wide | 0 |
| no visible focus outline outside inputs | global `:focus-visible` outline in the accent colour | — |

Result: **0 axe violations** on all pages scanned.

## SDK user interface

- **Web in-app messages** (`DispatchInAppMessage`, `@dispatch/react-sdk/web`): modal and full-screen
  layouts are `role="dialog"` with `aria-modal` and a labelled title. They take focus when shown and
  hand it back when closed, Escape dismisses them, and every action (including a linked title) is a
  real button. The dismiss control is 32 px and all text meets 4.5:1. Banners use `role="status"`.
- **iOS** (`.dispatchInAppMessages`) and **Android**: native SwiftUI / Android views, so VoiceOver,
  TalkBack, Dynamic Type and font scaling apply without extra work.
- **Push notifications** are drawn by the operating system; the SDKs add no custom notification UI.
  Rich images come from the template's image URL and carry no text of their own.

## Not covered by this pass

- This is an **internal, automated audit**. Automated tools find about 30–40 % of WCAG issues;
  manual checks (screen-reader walkthroughs, keyboard-only journeys through the campaign builder,
  200 % zoom and reflow) and an **independent third-party audit** are still needed before
  claiming conformance in a VPAT.
- The public email preference centre (`/u/<token>`) and the sign-in page benefit from
  the colour-token change but were not scanned (they need a live token or a signed-out session).
- Content authored in templates (email HTML, alt text for images) is the author's responsibility.
  The template editor doesn't yet warn about missing alt text.
