# How sign-in and authentication work in this app

Written for another team's dev who wants to build something similar in a different app —
this describes the actual working implementation in this repo (`apps/mobile` +
`apps/api`), not a design proposal. Every file/line reference below exists and is running.

## The short version

- **No backend sessions.** The server never issues its own session token or cookie. The
  client gets an ID token straight from whichever identity provider it signed in with
  (Firebase or Microsoft/Entra), stores it, and sends it as `Authorization: Bearer <token>`
  on every API request. The server verifies that token fresh on every request against the
  issuing provider's public keys — completely stateless on the server side.
- **Two providers run side by side**, each independently optional. Either can be entirely
  unconfigured with no code changes — see "How it degrades" below.
- **No native Firebase/MSAL SDK.** Firebase is talked to over its plain REST API. Microsoft
  is talked to via `expo-auth-session`'s generic OAuth/OIDC support pointed at the standard
  Microsoft identity platform endpoints — no `@react-native-firebase/*` or `react-native-msal`
  dependency anywhere. This keeps the native module surface small (relevant if, like this
  repo, you're also maintaining custom native modules for other things — one fewer set of
  native SDKs to keep building against React Native/Expo upgrades).

## Client side — `apps/mobile`

### Files

- `src/config/authConfig.ts` — every provider's public config (client IDs, authority URLs).
  Nothing in this file is secret — these are all public identifiers, safe to commit.
- `src/services/auth.ts` — everything else: sign-in flows, token storage, refresh,
  `authFetch()`.
- `src/screens/LoginScreen.tsx` — the UI.

### Providers implemented

**1. Firebase — email/password and Google**, via Firebase's plain REST API
(`identitytoolkit.googleapis.com`), not the native SDK:

```ts
// Sign in
POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=<API_KEY>
{ email, password, returnSecureToken: true }

// Sign up
POST .../v1/accounts:signUp?key=<API_KEY>
POST .../v1/accounts:update?key=<API_KEY>   // set displayName after signup

// Refresh
POST https://securetoken.googleapis.com/v1/token?key=<API_KEY>
grant_type=refresh_token&refresh_token=<token>
```

The Firebase Web API key (`FIREBASE_API_KEY` in `authConfig.ts`) is not a secret — it only
identifies which Firebase project, it doesn't authorize anything by itself. This is why the
REST API works with no native SDK and no server-side credentials on the client.

Google sign-in reuses Firebase as the account store: `expo-auth-session` runs a normal
Google OAuth flow (Authorization Code + PKCE) to get a Google ID token, then that token is
handed to Firebase's `accounts:signInWithIdp` endpoint, which mints a Firebase account/session
out of it. So "Google" and "email/password" end up as the same kind of Firebase session —
the app doesn't need to treat them differently after sign-in.

**2. Microsoft — a real Entra ID app registration**, via `expo-auth-session`'s generic OIDC
support (not Firebase, not MSAL):

```ts
const discovery = await AuthSession.fetchDiscoveryAsync(AUTH_AUTHORITY);
const redirectUri = AuthSession.makeRedirectUri({ scheme: AUTH_REDIRECT_SCHEME, path: "auth" });
const request = new AuthSession.AuthRequest({
  clientId: AUTH_CLIENT_ID,
  redirectUri,
  scopes: ["openid", "profile", "email", "offline_access"],
  responseType: AuthSession.ResponseType.Code,
  usePKCE: true
});
const result = await request.promptAsync(discovery);
const tokens = await AuthSession.exchangeCodeAsync({ clientId, code: result.params.code, redirectUri, extraParams: { code_verifier: request.codeVerifier } }, discovery);
```

This is a completely standard Authorization Code + PKCE OAuth flow — nothing
Microsoft-specific about the code itself. `AUTH_AUTHORITY` is what makes it point at
Microsoft: `https://login.microsoftonline.com/common/v2.0` (the "common" endpoint accepts
both work/school and personal Microsoft accounts). Swapping this one URL to point at a
different OIDC-compliant provider — Okta, Auth0, a different Entra tenant — is the entire
change needed to retarget this flow at something else.

**Why this matters for a custom URI scheme redirect**: the redirect back into the app after
the browser-based sign-in only works if the OS knows which app owns
`xconnect://auth` (`AUTH_REDIRECT_SCHEME` in `authConfig.ts`). That registration only exists
in an actual dev-client or release build — **Expo Go can't own a custom scheme**, so testing
this flow requires `expo run:android` / a real build, not `expo start` + Expo Go. This bit us
during testing (a teammate stuck on Microsoft's "Trying to sign you in" screen forever,
turned out to be exactly this).

### Token storage and refresh

- Stored via `expo-secure-store` (Android Keystore / iOS Keychain backed), not
  `AsyncStorage` — this is what protects the token at rest.
- One unified shape regardless of provider:
  ```ts
  type AuthSessionInfo = {
    provider: "firebase" | "microsoft";
    idToken: string;
    refreshToken?: string;
    expiresAt: number;
    name?: string;
    email?: string;
  };
  ```
- `getIdToken()` is the single choke point every API call goes through: returns the current
  token if it's not close to expiring (60s margin), otherwise refreshes first — Firebase and
  Microsoft each have their own refresh endpoint/call, branched on `session.provider`. A
  refresh token that's actually been revoked (not just a network blip) signs the user out;
  a network failure alone does not.
- `authFetch(url, init)` — a drop-in `fetch()` replacement that adds the bearer header
  automatically and signs the user out on a `401`. Every API call in the app uses this
  instead of raw `fetch()`.

### Reading the display name/email without a backend round-trip

ID tokens are JWTs — the payload is just base64url JSON, no verification needed client-side
to *read* it (the server is what verifies the signature; the client just wants the claims to
show in the UI immediately):

```ts
function decodeClaims(idToken: string) {
  const payload = idToken.split(".")[1] ...; // base64url decode the middle segment
  const claims = JSON.parse(json);
  return { name: claims.name, email: claims.email ?? claims.preferred_username };
}
```

### How it degrades with providers unconfigured

Every provider is gated behind a simple boolean derived from whether its config is present:

```ts
export const emailSignInAvailable = Boolean(FIREBASE_API_KEY);
export const googleSignInAvailable = Boolean(FIREBASE_API_KEY) && Platform.OS === "android" && Boolean(GOOGLE_ANDROID_CLIENT_ID);
export const microsoftSignInAvailable = Boolean(AUTH_AUTHORITY && AUTH_CLIENT_ID);
export const authConfigured = emailSignInAvailable || microsoftSignInAvailable;
```

`LoginScreen.tsx` conditionally renders each button on these — leave `AUTH_CLIENT_ID` empty
and the Microsoft button just doesn't render, no crash, no dead code path hit. If **nothing**
is configured, the whole login screen is effectively skipped (`authConfigured` is `false`)
and the app runs unauthenticated — useful for local dev without wiring any of this up.

## Cloud console setup (brief)

The code above assumes these already exist. Neither takes long, but both have a couple of
non-obvious steps.

### Firebase (console.firebase.google.com)

1. Create a project (or use an existing one).
2. **Authentication → Sign-in method** → enable **Email/Password**, and separately enable
   **Google** if you want Google sign-in too (Firebase manages the Google OAuth client for
   you automatically when you flip this on — no separate Google Cloud Console setup needed
   for basic use).
3. **Project settings → General** → copy the **Web API key** — this is `FIREBASE_API_KEY` in
   `authConfig.ts`. It's public by design (identifies the project, doesn't authorize
   anything), safe to commit.
4. For Google sign-in specifically on Android: Firebase's auto-managed Google OAuth client
   only works from Firebase's own SDKs. Since this app talks to Google directly via
   `expo-auth-session` (not the Firebase SDK), it needs its own **Android OAuth client ID**
   from **Google Cloud Console → APIs & Services → Credentials** (same GCP project Firebase
   created), registered with the app's package name and SHA-1 signing fingerprint. That
   client ID is `GOOGLE_ANDROID_CLIENT_ID` in `authConfig.ts`.
5. Server side only needs one value: **Project settings → General → Project ID** →
   `FIREBASE_PROJECT_ID` env var on the API. Nothing else from Firebase is needed
   server-side — token verification uses Google's public JWKS endpoint, not a Firebase SDK
   or service account.

### Microsoft Entra ID (portal.azure.com → Microsoft Entra ID → App registrations)

0. **Needs an Azure account first** — an app registration lives inside an Azure Active
   Directory tenant, which requires signing up at azure.com (the **free tier** is enough for
   this; app registrations themselves cost nothing, and Entra ID's free tier covers
   everything used here). Signing up creates a default tenant automatically if you don't
   already have one through an organization — nothing extra to provision beyond that.
1. **New registration**. Name it anything. Under **Supported account types**, pick
   **"Accounts in any organizational directory and personal Microsoft accounts"** — this is
   what makes the `common` authority endpoint work for both work/school and personal
   accounts. A narrower choice here (single tenant only) is also valid, it just changes
   `AUTH_AUTHORITY` later to that tenant's own endpoint instead of `common`.
2. **Authentication** → **Add a platform** → **Mobile and desktop applications** → add a
   custom redirect URI in the form `<scheme>://auth` (this app uses `xconnect://auth`) —
   must exactly match `AUTH_REDIRECT_SCHEME` in `authConfig.ts` and the app's own registered
   `scheme` in `app.json`, or the OS won't know which app to hand the redirect back to.
3. **No client secret needed.** This is a public client (PKCE) flow — leave "Certificates &
   secrets" untouched. A secret would only be needed for a confidential-client flow (e.g. a
   server-side web app), which this isn't.
4. Copy the **Application (client) ID** from the registration's Overview page —
   `AUTH_CLIENT_ID` on the client, and `AUTH_AUDIENCE` on the server (same value, both
   places — it's what the ID token's `aud` claim is checked against).
5. `AUTH_AUTHORITY` on the server is just `https://login.microsoftonline.com/common/v2.0`
   (or your tenant-specific equivalent) — no separate registration step for this, it's a
   fixed Microsoft endpoint, not something you create.
6. No API permissions need granting beyond the default `openid`/`profile`/`email` scopes
   requested in the code — those are always available, no admin consent required, since this
   only reads the signed-in user's own basic profile claims.

## Server side — `apps/api/src/auth.ts`

This is the more reusable half — genuinely provider-agnostic beyond two small `if` blocks.

### The core idea: verify, don't manage sessions

1. Read `Authorization: Bearer <token>` off the request.
2. Decode (not yet verify) the token just far enough to read its `iss` (issuer) claim.
3. Match that issuer against a small list of configured verifiers — one per identity
   provider you've enabled.
4. Verify the token's signature against **that** provider's public keys (JWKS), fetched
   over HTTPS and cached (`jose`'s `createRemoteJWKSet` handles both).
5. Re-check the issuer against the now-*verified* payload (not just the unverified peek from
   step 2) — this is what actually makes the routing trustworthy; step 2 alone is not proof
   of anything, since an attacker can put any `iss` they like in an unsigned decode.

```ts
async function verifyToken(token: string): Promise<JWTPayload> {
  const verifiers = await loadVerifiers();
  const claimedIssuer = decodeJwt(token).iss;             // unverified — only used to pick a verifier
  const verifier = verifiers.find((v) => v.issuerMatches(claimedIssuer));
  if (!verifier) throw new Error("no configured provider issued this token");
  const { payload } = await jwtVerify(token, verifier.jwks, { audience: verifier.audience });
  if (!verifier.issuerMatches(payload.iss)) throw new Error("issuer mismatch"); // re-check against the VERIFIED claim
  return payload;
}
```

### Configuring a verifier — env vars only, no code change to add a provider instance

```ts
// Firebase: one env var
FIREBASE_PROJECT_ID=your-project-id

// Any OIDC provider (Microsoft, Auth0, Okta, ...): two env vars
AUTH_AUTHORITY=https://login.microsoftonline.com/common/v2.0
AUTH_AUDIENCE=<app registration's client ID>
```

The OIDC verifier doesn't hardcode Microsoft anywhere — it does real OpenID discovery
(`GET {AUTHORITY}/.well-known/openid-configuration`) to find the issuer and JWKS URI, so
`AUTH_AUTHORITY` is genuinely swappable to any compliant provider with no code change.

**Multi-tenant issuer matching** is the one Microsoft-shaped wrinkle: the "common" authority
advertises its issuer as a *template*, `https://login.microsoftonline.com/{tenantid}/v2.0`,
with every real token substituting its own tenant GUID. A single-tenant authority (Entra
External ID, most other providers) just advertises its real, exact issuer. `issuerMatcher()`
detects the `{tenantid}` placeholder and builds a regex for that case, otherwise does a plain
string match:

```ts
function issuerMatcher(discovered: string): (issuer: string) => boolean {
  if (!discovered.includes("{tenantid}")) return (issuer) => issuer === discovered;
  const pattern = new RegExp(`^${...replace {tenantid} with [0-9a-fA-F-]{36}...}$`);
  return (issuer) => pattern.test(issuer);
}
```

If you're integrating a single-tenant-only provider, you can skip this entirely and just do
an exact string match — this only exists because of Microsoft's multi-tenant "common"
endpoint specifically.

### Turning auth off entirely

```ts
export const authEnabled = Boolean(FIREBASE_PROJECT_ID || (AUTHORITY && AUDIENCE));
```

With neither configured, `authenticate()` is a no-op (`return next()` immediately) and every
request is allowed through unauthenticated. This is the same "unset env var = POC/dev mode"
pattern the database layer uses (`DATABASE_URL` unset → in-memory mode) — consistent
degradation story across the whole backend, not auth-specific behavior bolted on.

### Turning a token into an app user (`resolveUser`)

The verified JWT payload only proves *who signed in*, not what your app knows about them.
`resolveUser()`:

- Reads a stable subject id (`oid` for Microsoft/Entra, `sub` as the general fallback —
  `oid` is preferred because Microsoft's `sub` can differ per-application, `oid` doesn't).
- Reads whatever email/name claims exist across providers (`email`, `emails`,
  `preferred_username`, `upn`, `name`) — the exact claim names differ per provider, so this
  tries several in priority order rather than assuming one shape.
- Upserts a `users` row (id, email, display name) — this is a normal app-domain user record;
  it exists so the app can attach *your own* app data to a person, not because auth itself
  needs a database.
- Determines admin status from a static env-var allowlist of emails
  (`ADMIN_EMAILS=alice@x.com,bob@x.com`) on first sight, but never downgrades an admin flag
  set directly in the database afterward — a deliberate one-way ratchet so revoking someone
  from the allowlist doesn't silently strip admin rights you'd set some other way.
- Caches the resolved user in memory for 5 minutes (`USER_REFRESH_MS`), so a client polling
  the API every few seconds doesn't hit the database on every single request — only signature
  verification happens on every request; the DB upsert is throttled.

### Route-level usage

```ts
app.use(authenticate);                 // attaches request.user if a valid token was sent
app.get("/api/admin/...", requireAdmin, handler);   // 403s if request.user.isAdmin is false
```

`authenticate` 401s on a missing/invalid token (when `authEnabled`), except for
`/health`/`/api/health`, which stay open for uptime checks that never carry a token.

## Adapting this for a different app

What's generic and copy-pasteable as-is:
- The whole server-side verifier pattern (`auth.ts`) — provider-agnostic by design, add a
  provider by adding env vars, not code, as long as it's a standard OIDC provider.
- The client's `authFetch`/token-refresh/SecureStore pattern — none of it is XConnect-specific.
- The Firebase REST API approach, if you also want to avoid the native Firebase SDK.

What's specific to this app and would need renaming/removing:
- `ADMIN_EMAILS` allowlist and `isAdmin` — this app's specific authorization model; a
  different app likely has its own roles/permissions shape.
- `AUTH_REDIRECT_SCHEME = "xconnect"` — pick your own app's scheme, and register it in
  `app.json`'s `scheme` field so Android/iOS actually route it back to your app.
- The `google.com` / Microsoft-specific pieces are each isolated enough to drop independently
  if you only need one of the three (email/password, Google, Microsoft).
