# Signup delivery and validation release, 21 November 2026

The Render frontend and API are live at `d9d9c5257a8e816a85ddc48974ba34ce089deaff`, built from the reviewed `final-version` changes at `cb093f0e3e61ab6c6c782c5a36af726555a16264`. See [verification results](../evidence/signup-delivery-2026-11-21/checks.json).

## Behavior

The API now explicitly requests an email verification code after an accepted signup response, using the same Neon endpoint as resend. Provider acknowledgement is required before reporting that a code was requested. Sending errors retain the verification/resend recovery path without claiming that a new account was created. Neon automatic signup/sign-in emails are disabled to avoid a second sender; verification remains required and uses OTP. This confirms request acceptance, not inbox delivery.

New signup and reset passwords require 8–128 characters, an uppercase letter, an ASCII digit and a punctuation or symbol character. The form shows a requirement checklist and the API enforces the rule independently. Existing password login is unchanged. Email syntax checks handle domain normalization and preserve plus addresses. A sign-in shortcut appears after a valid email without looking up or exposing account existence.

Authentication text buttons and footer links no longer have underlines. Hidden board images leave noninteractive blank slots so the remaining images keep their positions. Completely hidden pages are skipped and an entirely hidden board shows an empty state.

## Deployment and verification

Registration was briefly paused during the change from provider sending to explicit API sending. The older API was retired before Neon settings changed, then the same reviewed API commit was activated. Registration is open again. Both services remain on their existing free plans.

The release passed 312 frontend unit tests and 311 API tests. Five PostgreSQL migration checks were skipped because a separate test database was not configured. The production build passed with the existing JavaScript chunk-size warning. Twenty authentication browser scenarios used mocked account APIs; 24 board and feature scenarios used local fixture data. These tests did not send real email.

Live browser checks at 1280, 390 and 320 pixels confirmed email errors, the password checklist, login navigation, no horizontal overflow and no authentication-link underlines. They observed no page errors or attempted writes. Live API checks confirmed explicit mode and rejection of invalid email/weak password inputs before provider calls, without reflecting submitted values. These are browser-emulation checks, not new physical-device evidence.

A manual resend had reached the user's mailbox before this release. Initial-signup inbox delivery after this release still requires user confirmation; no new real account or email was created by the live checks.

## Runtime deployments

- Frontend: `dep-dc0tam59el5s73f60fh0`.
- API: `dep-dc0tcs8m7kps73eib9j0`.
- Rollout and rollback configuration: [Neon authentication guide](../neon-auth.md#signup-verification-delivery).
