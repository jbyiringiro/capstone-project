# Account password and device PIN, 21 November 2026

Caregiver sign-in now has two screens. The first checks the email and account password. The second creates a 4–6 digit device PIN, or asks for the existing device PIN. It explains that the PIN opens caregiver settings on this device, including offline, and differs from the email account password. The authentication header stays visible while the form scrolls.

After password authentication, credentials remain in memory for up to five minutes. A new PIN, account identity and session are saved together only after PIN confirmation and server identity revalidation. Existing device PINs are checked without replacement. Back, close, reload, expiry and late responses cannot restore an abandoned pending login. Changes to the linked account or PIN in another tab stop completion.

Validation passed 331 frontend unit tests, 27 mocked Neon browser scenarios and 27 mocked compatibility scenarios for the legacy Firebase mode. Checks cover desktop, 390px and 320px layouts, sticky navigation, field visibility, invalid passwords, invalid and mismatched PINs, cancellation, atomic rollback, account changes and existing-PIN preservation. The production build passed with the existing bundle-size warning. See [verification summary](../evidence/account-pin-2026-11-21/checks.json).

These checks use synthetic accounts and intercepted authentication requests. They do not constitute new physical-device testing or a live mailbox-delivery test. The API server and Neon email delivery configuration do not change in this frontend release.
