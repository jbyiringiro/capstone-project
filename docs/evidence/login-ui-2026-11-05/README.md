# Login UI follow-up — 5 November 2026

The caregiver entry screen now uses shorter Kinyarwanda copy, separate signup/login/verification/reset states, password visibility controls, a clearly grouped device PIN and an expandable legacy-phone option. Verification uses an email link. Resending is manual, password-authenticated, and has a 60-second UI cooldown after successful sending or provider throttling. The app does not introduce an email-delivery delay or promise an arrival time.

The project owner confirmed that Email/Password is enabled and verification email arrives within two minutes. This is user-reported; no delivery timings were independently measured. All browser authentication requests below were mocked, and no real email, account deletion, production deployment or user browser-storage mutation was performed by these checks.

| Check | Result | Evidence |
|---|---|---|
| Frontend unit/integration suite | 218 passed across 31 files | `npm test -- --maxWorkers=2 --minWorkers=1` |
| Email browser flow | 21 passed, zero page errors | [Report](email-accounts-report.json) |
| Caregiver access regression | 17 passed | [Report](parent-access/parent-access-report.json) |
| Board/speech/Kinyarwanda regression | 25 passed | [Report](kinyarwanda/browser-report.json) |
| Production build | Passed; JS approximately 515 kB / 161 kB gzip | `npm run build`; existing Vite warning above 500 kB remains |
| Responsive UI | No horizontal overflow at 320px and 390px | Screenshots below; browser emulation, not physical-device testing |

There are **63 browser checks** in this follow-up; these overlap the preceding email-account evidence and should not be added to it as distinct coverage. The final email run tested `index-DJ1O_GiM.js` (SHA-256 `02a0d38e7876b8fcc8fafca6de754eddac7549ce348f10afc8eaa2ff40f4d110`) and `index-9teyF00N.css`. The email report records hashes from the assets actually loaded by the browser. The two regression suites passed immediately before the final label/spacing and throttled-resend countdown refinements; the final email suite covers those refinements.

Coverage includes password confirmation, show/hide controls, unverified-account rejection, successful verification, countdown and duplicate-request protection, provider errors and throttling, already-verified resend, email-only password reset, separate offline PINs, relinking, identity-bound recovery, deletion retries and legacy-phone navigation.

- [Desktop signup](email-signup-desktop.png)
- [Signup at 390px](email-signup-390.png)
- [Login at 320px](email-login-320.png)
- [Verification at 390px](email-verify-390.png)

The local preview was rebuilt at `http://localhost:5173/`. Render has not received this update. Live password-reset/deletion, PostgreSQL migration validation and physical-device checks remain separate follow-up work in the [email setup guide](../../email-accounts.md).
