# Entra External ID (CIAM) tenant setup

Step-by-step record of standing up an Entra External ID tenant for customer-facing sign-in
(email/password, and originally Google as a federated identity provider). This lives on
`feature/entra-external-id-auth`, kept separate from `feature/postgres-persistence`
per an explicit decision to not mix it into the notification-feature work.

## Why a separate tenant type

The app's existing Microsoft sign-in uses a plain Entra ID (workforce) tenant — fine for
organizational/personal Microsoft accounts, but it does **not** support open self-service
sign-in with local email/password accounts or federated social identity providers like
Google. That requires a different tenant *type*: **Entra External ID for customers**
(CIAM). This is created as an entirely separate tenant from any workforce tenant, not a
setting toggled on an existing one.

**Important finding from this setup**: a CIAM tenant's built-in "Microsoft Account"
identity provider only supports invite-only/guest scenarios ("Users with a Microsoft
account can be invited via email and sign in without further configuration") — it does
**not** give open self-service Microsoft sign-in. That's why Microsoft sign-in stays on
the separate plain Entra ID tenant/app registration, and the External ID tenant only
handles email/password (and, originally, Google).

## Part 1 — Create the tenant

1. Azure Portal → Microsoft Entra admin center → "Create a tenant".
2. Tenant type: **External** (not "Microsoft Entra ID" workforce type).
3. Basics:
   - Organization name: e.g. `XConnect Test`.
   - Initial domain: e.g. `xconnecttest` (becomes `xconnecttest.onmicrosoft.com` /
     `xconnecttest.ciamlogin.com`).
4. "Use an Azure Subscription" — pick an existing subscription (this doesn't cost anything
   by itself; External ID tenants have a free monthly active user allowance before any
   billing kicks in).
5. Resource group: e.g. `xconnect-test-rg`. Region: any — doesn't materially matter for a
   directory resource, pick something geographically close for marginal latency.
6. Create. Note the resulting **Tenant ID** (a GUID) — needed for the authority URL later.

## Part 2 — Register an application in the new tenant

1. Switch directories (top-right account menu → "Switch directory") into the new External
   ID tenant.
2. Entra admin center → "App registrations" → "New registration".
3. Name: e.g. `XConnect-test-dev`.
4. **Supported account types**: must be set to **single tenant only** ("Accounts in this
   organizational directory only"). If it defaults to something else, go to
   Authentication (or the registration's Overview → "Supported account types" link) and
   fix it — a multi-tenant setting here doesn't make sense for a CIAM tenant meant to be
   this app's own customer directory.
5. Add a **native/mobile redirect URI**: platform "Mobile and desktop applications",
   URI `xconnect://auth` (matches `AUTH_REDIRECT_SCHEME` in
   `apps/mobile/src/config/authConfig.ts`).
6. Note the **Application (client) ID** — needed for `EXTERNAL_AUTH_CLIENT_ID`.

## Part 3 — Add Google as a federated identity provider

(This part was completed, then later reconsidered — see "Decision: Google moved back to
Firebase" below. Kept here since the Google IdP is still configured on the tenant even
though the app doesn't currently route Google sign-in through it.)

1. Entra admin center → "Identity providers" (or "External Identities" → "All identity
   providers") → "Google".
2. This requires an OAuth 2.0 client ID/secret from **Google Cloud Console**. The
   existing Firebase-linked GCP project (`xconnect-2b9a3`) can be reused — no need for a
   second Google Cloud project.
3. In Google Cloud Console (console.cloud.google.com), that project → "APIs & Services" →
   "Credentials" → "Create Credentials" → "OAuth client ID" → type "Web application".
4. Add the redirect URIs Microsoft's docs specify for a CIAM tenant (seven total,
   covering the tenant's login domain and the `ciamlogin.com` region), of the form:
   `https://<sub>.ciamlogin.com/<tenant-id>/federation/oidc/...` and the equivalent
   `.b2clogin.com`/`.microsoftonline.com` variants — copy these directly from
   [Microsoft's Google federation guide](https://learn.microsoft.com/en-us/entra/external-id/customers/how-to-google-federation-customers)
   rather than guessing, they're tenant-specific.
5. Under "OAuth consent screen" (or "Branding"), Google requires:
   - An **Application home page** — if validation fails here, a Firebase Hosting default
     URL works fine as a placeholder, e.g. `https://xconnect-2b9a3.firebaseapp.com`.
   - A **Privacy policy link**.
6. Add `ciamlogin.com` and `login.microsoftonline.com` to "Authorized domains" on the
   consent screen.
7. Back in Entra: paste the Google OAuth client ID + client secret into the Google
   identity provider config, save.

## Part 4 — Create a user flow

1. Entra admin center → "User flows" → "New user flow".
2. Name: e.g. `SignUpSignIn`.
3. Identity providers: check **Email with password** and **Google**.
4. User attributes/claims: defaults are fine to start.
5. Under the user flow → "Applications" → add the app registration from Part 2, so the
   flow actually applies to this app's sign-in requests.

## Part 5 — Test it

1. Entra admin center → the user flow → "Run user flow".
2. The test tool redirects to `https://jwt.ms` to display the resulting token — this
   requires `https://jwt.ms` to be registered as a **Web** platform redirect URI on the
   app registration (separate from the native `xconnect://auth` one from Part 2). Without
   it, the test tool hangs/loops after consent instead of completing. This redirect URI
   is only needed for the portal's own test tool, not for the real app.
3. Confirm both Email and Google sign-in complete and `jwt.ms` shows a decoded token.

## Part 6 — Wire into the app

1. `apps/mobile/src/config/authConfig.ts`:
   ```ts
   export const EXTERNAL_AUTH_AUTHORITY =
     "https://xconnecttest.ciamlogin.com/<tenant-id>/v2.0";
   export const EXTERNAL_AUTH_CLIENT_ID = "<app registration client id>";
   export const AUTH_REDIRECT_SCHEME = "xconnect";
   ```
2. `apps/mobile/src/services/auth.ts` — `configFor(provider)` picks between the existing
   Microsoft-tenant config and this External ID config depending on which button was
   pressed; both funnel through a shared `signInViaOidc(provider, failureMessage,
   domainHint?)`.
3. **Server side** (`apps/api/src/auth.ts`) — the server must accept tokens from *both*
   tenants, not just one, or sign-in will succeed client-side and then immediately bounce
   back to the login screen (the server's `authFetch` wrapper signs the user out on any
   401). Added a second verifier via new env vars:
   ```
   AUTH_AUTHORITY_2=https://xconnecttest.ciamlogin.com/<tenant-id>/v2.0
   AUTH_AUDIENCE_2=<app registration client id>
   ```
   `loadVerifiers()` now builds one verifier per configured authority/audience pair
   (Firebase + primary OIDC + this second OIDC), and a token is accepted if any verifier
   accepts it.

## Known issues hit during setup

- **`AADSTS90023: 'google' pair is not an external identity provider`** — Microsoft's
  documented `domain_hint=google` "issuer acceleration" parameter (meant to skip the
  provider-picker page and jump straight to Google) is rejected outright by this tenant
  configuration, despite being documented behavior. Fix: don't pass `domain_hint`; accept
  that Google and Email land on the same hosted picker page (one extra tap).
- **Google button silently signs in as whatever Microsoft/email account was last used**
  (SSO session sharing) — the CIAM tenant's browser session persists across "buttons,"
  so pressing "Google" can silently continue an existing session instead of prompting.
  Fix: add `prompt: "select_account"` unconditionally to every OIDC authorize request,
  forcing the account chooser every time.

## Decision: Google moved back to Firebase (agreed, not yet reverted)

After hitting the two issues above, and after reconsidering while comparing this
architecture against Firebase's own (already-working) Google OAuth setup, the better
long-term shape was agreed to be:

- **Google sign-in**: back on Firebase (its original implementation — the code is already
  present in `apps/mobile/src/services/auth.ts`, currently commented out, not deleted).
- **Email/password**: stays on this Entra External ID tenant.
- **Microsoft sign-in**: stays on the separate plain Entra ID tenant (Part 2's app
  registration is unrelated to this).

Reasoning: Firebase already owns and manages its own Google OAuth client end-to-end; routing
Google through Entra as a federated IdP on top of that just reproduces the same OAuth
client one layer higher, while introducing the SSO-session-sharing and `domain_hint`
problems above for no real benefit. Three separate, independent sign-in paths (Firebase
Google, Entra External ID email, plain Entra Microsoft) is simpler than two tenants each
partially covering overlapping ground.

**This reversion has been agreed but is explicitly deferred** — it was intentionally left
undone on `feature/entra-external-id-auth` in favor of starting the notification feature
on `feature/postgres-persistence`. To pick it back up: uncomment the Firebase functions in
`auth.ts`, repoint the Google button in `LoginScreen.tsx` at `signInWithGoogle`'s Firebase
path instead of the OIDC path, and the Google identity provider configured on the External
ID tenant (Part 3) can be left in place unused or removed later — it costs nothing to
leave configured.

## What this has nothing to do with

The Azure Notification Hub (see [NOTIFICATION_HUB_SETUP.md](NOTIFICATION_HUB_SETUP.md)) is
a plain subscription-scoped resource, unrelated to which Entra tenant(s) manage sign-in —
it can sit under any subscription/directory without conflicting with either tenant
described here.
