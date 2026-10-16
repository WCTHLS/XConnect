// Sign-in providers. Leave everything empty to run without login (POC mode).
// Firebase (email/password + Google) and Microsoft run side by side; either can be left empty.
//
// The values come from environment variables, set in apps/mobile/.env (ignored by git; copy
// apps/mobile/.env.example). Expo copies every EXPO_PUBLIC_* value into the app when it is built, so
// they end up inside the app and are NOT secret: they are identifiers. Keeping them in .env just
// keeps per-environment values (company, personal, a client's) out of the repository.
//
// A change needs a restart of Metro (npx expo start --clear) for a debug build, and a new build for
// a release build.

const read = (value: string | undefined) => (value ?? "").trim();

// Firebase Auth (Project settings > General). The web API key is not a secret.
export const FIREBASE_API_KEY = read(process.env.EXPO_PUBLIC_FIREBASE_API_KEY);

// Google sign-in (Android OAuth client from Google Cloud Console, same project as Firebase).
// Public identifier, not a secret. Empty hides the Google button on Android.
export const GOOGLE_ANDROID_CLIENT_ID = read(process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID);

// Google sign-in (iOS OAuth client from Google Cloud Console, same project as Firebase).
// Public identifier, not a secret. Empty hides the Google button on iOS.
export const GOOGLE_IOS_CLIENT_ID = read(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID);

// Microsoft sign-in, via an Entra ID app registration. Empty AUTH_CLIENT_ID hides the button.
//
// AUTH_CLIENT_ID: that registration's Application (client) ID. Public identifier, not a secret.
// AUTH_AUTHORITY: the sign-in address. By default the common endpoint, which covers work, school and
//   personal accounts for a Workforce-tenant registration. For an External ID tenant either set
//   EXPO_PUBLIC_AUTH_AUTHORITY outright, or set EXPO_PUBLIC_AUTH_SUBDOMAIN and EXPO_PUBLIC_AUTH_TENANT_ID,
//   which build https://<subdomain>.ciamlogin.com/<tenant-id>/v2.0. The app and the server must use the
//   same authority.
// AUTH_REDIRECT_SCHEME: must match the registration's redirect URI (xconnect://auth) and the app's
//   URL scheme in app.json, so it is fixed here rather than read from the environment.
const authorityFromEnv = read(process.env.EXPO_PUBLIC_AUTH_AUTHORITY);
const authSubdomain = read(process.env.EXPO_PUBLIC_AUTH_SUBDOMAIN);
const authTenantId = read(process.env.EXPO_PUBLIC_AUTH_TENANT_ID);

export const AUTH_AUTHORITY = (
  authorityFromEnv ||
  (authSubdomain && authTenantId
    ? `https://${authSubdomain}.ciamlogin.com/${authTenantId}/v2.0`
    : "https://login.microsoftonline.com/common/v2.0")
).replace(/\/+$/, "");
export const AUTH_CLIENT_ID = read(process.env.EXPO_PUBLIC_AUTH_CLIENT_ID);
export const AUTH_REDIRECT_SCHEME = "xconnect";
