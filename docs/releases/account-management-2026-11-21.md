# Account management release — 21 November 2026

Caregivers can now edit their account name and permanently delete their cloud account from **Umurezi → Kwinjira**. Both hosted services run `527a84e94ee40ce4669da546f0ddacf36d101840`. The same code was pushed to `final-version` as `6a48f50`.

## Behavior

**Hindura izina → Bika izina** updates the name in Neon and Vuga after verifying the signed-in identity. Email, account ID, child ownership and backup links do not change. An expired session prompts for the account password.

**Siba konti yanjye → Siba konti burundu** requires the account password and confirmation. It deletes the Vuga cloud data and Neon identity, rejects old sessions and clears this device's account link only after confirmed completion. Device children, words, recordings and the local PIN remain. The confirmation explains this distinction.

The real Neon self-service `/delete-user` call returned 404. The API now uses the documented Neon management deletion endpoint with a backend-only Vuga-project-scoped key. Fresh authentication, exact ownership and a matching production Auth URL/project/branch are checked before erasure. Only a 204 provider response confirms deletion. A provider outage is reported as pending cleanup; a lost response can require operator reconciliation.

## Validation

All 261 frontend tests and 248 API tests passed. Five PostgreSQL migration tests were skipped because their separate test database was not configured. The frontend production build and 15 browser scenarios with mocked API responses passed.

Thirteen checks exercised the actual Vuga API against a disposable account on an isolated Neon branch and a temporary local application database: name editing, repeat login, rejected unauthorized and mismatched-account operations, child-data erasure, confirmed deletion/retry and refusal of the old session and password login. The provider user was independently absent afterward. Test email sending was disabled and only the synthetic fixture was marked verified, so this was not a mailbox-delivery test. The temporary branch was removed.

On production, a newly created synthetic directory user was removed with HTTP 204, confirming the deployed management credential's deletion permission. No existing user was changed. Eight configuration checks confirmed the production branch binding and that the management key is absent from the frontend. Seven hosted API checks and 24 fresh-browser checks passed. The browser account-settings view used synthetic local data without sending writes; 390- and 320-pixel checks are emulation, not physical-device tests.

See [verification results](../evidence/account-management-2026-11-21/verification.json) and the [synthetic mobile settings screenshot](../evidence/account-management-2026-11-21/mobile-name-editor.png).

## Deployment and operation

The API was deployed first with deletion disabled, then restarted with management deletion enabled; the frontend followed. API deployment: `dep-dc0r4jm7bikc73bl76vg`. Frontend deployment: `dep-dc0r5517lnhs739h0s30`. The production database URL and persistent JWT secret were retained. Hosting stays on Render and Neon Free plans.

The existing Vuga-project-scoped local deployment key is also stored as the Render API secret. It is never placed in a `VITE_` variable or source control. Rotating that key must update both its local deployment profile and the Render API environment. A dedicated same-scope runtime key can later separate their rotation.

For rollback to code without managed deletion, first set `VUGA_NEON_DELETE_ENABLED=false`. Reverting code alone does not restore deleted accounts, and the production database should not be replaced with an older copy.
