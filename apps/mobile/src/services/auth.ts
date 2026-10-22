import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import {
  AUTH_AUTHORITY,
  AUTH_CLIENT_ID,
  AUTH_REDIRECT_SCHEME,
  FIREBASE_API_KEY,
  GOOGLE_ANDROID_CLIENT_ID,
  GOOGLE_IOS_CLIENT_ID
} from "../config/authConfig";

WebBrowser.maybeCompleteAuthSession();

// Firebase (email/password, Google) and Microsoft run side by side; a session records which one
// signed it in, since that decides how it is refreshed.
export const emailSignInAvailable = Boolean(FIREBASE_API_KEY);
export const googleSignInAvailable =
  Boolean(FIREBASE_API_KEY) &&
  Boolean(Platform.OS === "ios" ? GOOGLE_IOS_CLIENT_ID : GOOGLE_ANDROID_CLIENT_ID);
export const microsoftSignInAvailable = Boolean(AUTH_AUTHORITY && AUTH_CLIENT_ID);
export const authConfigured = emailSignInAvailable || microsoftSignInAvailable || googleSignInAvailable;

export type AuthSessionInfo = {
  provider: "firebase" | "microsoft";
  idToken: string;
  refreshToken?: string;
  expiresAt: number;
  name?: string;
  email?: string;
  /** Firebase's email_verified claim. Undefined on sessions stored before it was read, until the next token refresh. */
  emailVerified?: boolean;
};

const SCOPES = ["openid", "profile", "email", "offline_access"];
const STORE_KEY = "xconnect.auth.session";
const EXPIRY_MARGIN_MS = 60_000;

let session: AuthSessionInfo | null = null;
let loaded = false;
const listeners = new Set<(s: AuthSessionInfo | null) => void>();
let discoveryPromise: Promise<AuthSession.DiscoveryDocument> | undefined;

function publish(next: AuthSessionInfo | null) {
  session = next;
  listeners.forEach((l) => l(next));
}

function getDiscovery() {
  if (!discoveryPromise) {
    discoveryPromise = AuthSession.fetchDiscoveryAsync(AUTH_AUTHORITY).catch((err) => {
      discoveryPromise = undefined;
      throw err;
    });
  }
  return discoveryPromise;
}

function parseClaims(idToken: string): Record<string, any> | undefined {
  try {
    let payload = idToken.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    // JWT segments are unpadded base64url; atob requires a length that's a multiple of 4.
    while (payload.length % 4) payload += "=";
    const json = decodeURIComponent(
      atob(payload)
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

/** When the person last typed their credentials (Firebase's auth_time claim, which survives token refreshes), in ms. */
function authTimeMs(idToken: string): number | undefined {
  const value = parseClaims(idToken)?.auth_time;
  return typeof value === "number" ? value * 1000 : undefined;
}

function decodeClaims(idToken: string): { name?: string; email?: string; emailVerified?: boolean } {
  try {
    const claims = parseClaims(idToken);
    if (!claims) return {};
    const email = [claims.email, claims.emails, claims.preferred_username].flat().find((v) => typeof v === "string");
    return {
      name: typeof claims.name === "string" ? claims.name : undefined,
      email,
      emailVerified: typeof claims.email_verified === "boolean" ? claims.email_verified : undefined
    };
  } catch {
    return {};
  }
}

function toSession(tokens: AuthSession.TokenResponse, previous?: AuthSessionInfo): AuthSessionInfo {
  const idToken = tokens.idToken ?? previous?.idToken ?? "";
  return {
    provider: "microsoft",
    idToken,
    refreshToken: tokens.refreshToken ?? previous?.refreshToken,
    expiresAt: Date.now() + (tokens.expiresIn ?? 3600) * 1000,
    ...decodeClaims(idToken)
  };
}

async function persist(next: AuthSessionInfo | null) {
  try {
    if (next) await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(next));
    else await SecureStore.deleteItemAsync(STORE_KEY);
  } catch {
    // Storage failure only means the user signs in again next launch.
  }
}

// ---- Firebase Auth over its REST API (no native SDK needed) ----

const FIREBASE_AUTH_URL = "https://identitytoolkit.googleapis.com/v1";
const FIREBASE_TOKEN_URL = "https://securetoken.googleapis.com/v1/token";

const FIREBASE_ERRORS: Record<string, string> = {
  EMAIL_EXISTS: "An account with this email already exists. Try signing in.",
  INVALID_LOGIN_CREDENTIALS: "Wrong email or password.",
  INVALID_PASSWORD: "Wrong email or password.",
  EMAIL_NOT_FOUND: "No account found with this email.",
  INVALID_EMAIL: "That email address does not look right.",
  MISSING_PASSWORD: "Enter a password.",
  USER_DISABLED: "This account has been disabled.",
  TOO_MANY_ATTEMPTS_TRY_LATER: "Too many attempts. Try again in a few minutes."
};

type FirebaseTokens = { idToken: string; refreshToken: string; expiresIn: string };

async function firebasePost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${FIREBASE_AUTH_URL}/${path}?key=${FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = String(data?.error?.message ?? "");
    if (code.startsWith("WEAK_PASSWORD")) throw new Error("Password must be at least 6 characters.");
    const failure: Error & { code?: string } = new Error(FIREBASE_ERRORS[code.split(" ")[0]] ?? "Something went wrong. Try again.");
    failure.code = code.split(" ")[0];
    throw failure;
  }
  return data;
}

function firebaseSession(data: FirebaseTokens, nameOverride?: string, emailOverride?: string): AuthSessionInfo {
  return {
    provider: "firebase",
    idToken: data.idToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + Number(data.expiresIn || 3600) * 1000,
    ...decodeClaims(data.idToken),
    ...(nameOverride ? { name: nameOverride } : {}),
    ...(emailOverride ? { email: emailOverride } : {})
  };
}

async function finishFirebaseSignIn(data: FirebaseTokens, nameOverride?: string, emailOverride?: string) {
  const next = firebaseSession(data, nameOverride, emailOverride);
  await persist(next);
  publish(next);
}

export async function signInWithEmail(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const data = await firebasePost("accounts:signInWithPassword", { email: email.trim(), password, returnSecureToken: true });
    await finishFirebaseSignIn(data, undefined, email.trim());
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message };
  }
}

export async function signUpWithEmail(name: string, email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const created = await firebasePost("accounts:signUp", { email: email.trim(), password, returnSecureToken: true });
    if (name.trim()) {
      await firebasePost("accounts:update", { idToken: created.idToken, displayName: name.trim() });
    }
    // Re-authenticate instead of trusting accounts:update's own response for the session: that
    // endpoint's token doesn't reliably carry the just-set name yet (Firebase's claim can lag the
    // write) and its response isn't guaranteed to include a refreshToken the way a real sign-in's
    // does. A plain sign-in — the same call signInWithEmail already relies on — is guaranteed
    // complete, and by now the update above has landed.
    const data = await firebasePost("accounts:signInWithPassword", { email: email.trim(), password, returnSecureToken: true });
    await finishFirebaseSignIn(data, name.trim() || undefined, email.trim());
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message };
  }
}

/** Google account sign-in: Google's page in the browser gives a Google token, which Firebase turns into an account. */
export async function signInWithGoogle(): Promise<{ ok: boolean; error?: string }> {
  try {
    const googleClientId = Platform.OS === "ios" ? GOOGLE_IOS_CLIENT_ID : GOOGLE_ANDROID_CLIENT_ID;
    if (!googleClientId) return { ok: false, error: "Google sign-in is not configured for this platform." };

    const discovery = await AuthSession.fetchDiscoveryAsync("https://accounts.google.com");
    // Android and iOS OAuth clients accept a redirect built from their own client ID.
    const redirectUri = `com.googleusercontent.apps.${googleClientId.replace(".apps.googleusercontent.com", "")}:/oauthredirect`;
    const request = new AuthSession.AuthRequest({
      clientId: googleClientId,
      redirectUri,
      scopes: ["openid", "profile", "email"],
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true
    });
    const result = await request.promptAsync(discovery);
    if (result.type !== "success") {
      return { ok: false, error: result.type === "cancel" || result.type === "dismiss" ? undefined : "Google sign-in failed" };
    }
    const tokens = await AuthSession.exchangeCodeAsync(
      {
        clientId: googleClientId,
        code: result.params.code,
        redirectUri,
        extraParams: request.codeVerifier ? { code_verifier: request.codeVerifier } : undefined
      },
      discovery
    );
    if (!tokens.idToken) return { ok: false, error: "Google did not return a sign-in token." };
    const data = await firebasePost("accounts:signInWithIdp", {
      postBody: `id_token=${encodeURIComponent(tokens.idToken)}&providerId=google.com`,
      requestUri: "http://localhost",
      returnSecureToken: true,
      returnIdpCredential: true
    });
    await finishFirebaseSignIn(data);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Google sign-in failed" };
  }
}

export async function sendPasswordReset(email: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await firebasePost("accounts:sendOobCode", { requestType: "PASSWORD_RESET", email: email.trim() });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message };
  }
}

/** Sends (or resends) the verification email for the signed-in email/password account. */
export async function sendVerificationEmail(): Promise<{ ok: boolean; error?: string }> {
  try {
    const idToken = await getIdToken();
    if (!idToken || session?.provider !== "firebase") return { ok: false, error: "Sign in again to verify your email." };
    await firebasePost("accounts:sendOobCode", { requestType: "VERIFY_EMAIL", idToken });
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message };
  }
}

/**
 * Asks Firebase for a fresh token, which carries the current email_verified value, so a link
 * clicked in the mailbox shows up here. The server reads the same claim, so after this the account
 * is trusted without signing out.
 */
export async function checkEmailVerified(): Promise<{ ok: boolean; verified?: boolean; error?: string }> {
  try {
    const current = session;
    if (!current?.refreshToken || current.provider !== "firebase") return { ok: false, error: "Sign in again to verify your email." };
    const refreshed = await refreshFirebase(current.refreshToken);
    // A refreshed token does not always repeat the display name, so keep what the session had.
    const next = { ...refreshed, name: refreshed.name ?? current.name, email: refreshed.email ?? current.email };
    await persist(next);
    publish(next);
    return { ok: true, verified: next.emailVerified === true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Could not check right now. Try again." };
  }
}

async function refreshFirebase(refreshToken: string): Promise<AuthSessionInfo> {
  const res = await fetch(`${FIREBASE_TOKEN_URL}?key=${FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error: any = new Error(data?.error?.message ?? "refresh failed");
    error.rejected = res.status >= 400 && res.status < 500;
    throw error;
  }
  return firebaseSession({ idToken: data.id_token, refreshToken: data.refresh_token, expiresIn: data.expires_in });
}

export async function loadStoredSession() {
  if (!authConfigured || loaded) return;
  loaded = true;
  try {
    const raw = await SecureStore.getItemAsync(STORE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as AuthSessionInfo;
      publish({ ...stored, provider: stored.provider ?? "firebase" });
    }
  } catch {
    // Unreadable stored session: treat as signed out.
  }
}

/**
 * Microsoft account sign-in, straight to Microsoft rather than through Firebase: Firebase refuses
 * manually supplied Microsoft credentials (it can't verify their audience), so its own handshake
 * would need the native SDK. The API accepts both providers, so these accounts work like any other.
 */
export async function signInWithMicrosoft(): Promise<{ ok: boolean; error?: string }> {
  try {
    const discovery = await getDiscovery();
    const redirectUri = AuthSession.makeRedirectUri({ scheme: AUTH_REDIRECT_SCHEME, path: "auth" });
    const request = new AuthSession.AuthRequest({
      clientId: AUTH_CLIENT_ID,
      redirectUri,
      scopes: SCOPES,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
      prompt: AuthSession.Prompt.SelectAccount
    });
    // createTask: false keeps the browser tab inside this app's task instead of Chrome's own. When
    // sign-in sends the person to an authenticator app (Duo, Microsoft Authenticator), some Android
    // phones close Chrome's separate task and the sign-in is lost; staying in the app's task makes
    // the tab survive the switch and Back return to it.
    const result = await request.promptAsync(discovery, { createTask: false });
    if (result.type !== "success") {
      if (result.type === "cancel") return { ok: false };
      if (result.type === "dismiss") {
        return { ok: false, error: "Sign-in did not finish. If you went to an authenticator app, try again and come back with the Back button." };
      }
      return { ok: false, error: "Microsoft sign-in failed" };
    }
    const tokens = await AuthSession.exchangeCodeAsync(
      {
        clientId: AUTH_CLIENT_ID,
        code: result.params.code,
        redirectUri,
        extraParams: request.codeVerifier ? { code_verifier: request.codeVerifier } : undefined
      },
      discovery
    );
    const next = toSession(tokens);
    await persist(next);
    publish(next);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "Microsoft sign-in failed" };
  }
}

/**
 * Removes the Firebase account that was just created and signs out. Used when a brand-new sign-up
 * is refused straight away (a non-admin choosing Admin), so the attempt leaves no account behind.
 * If the deletion fails the person is still signed out, and the account is left to be cleaned up.
 */
export async function discardNewAccount() {
  try {
    const idToken = await getIdToken();
    if (idToken && session?.provider === "firebase") await firebasePost("accounts:delete", { idToken });
  } catch {
    // Best effort: signing out below is what matters for the person.
  }
  await signOut();
}

export async function signOut() {
  await persist(null);
  publish(null);
}

// Firebase only deletes a sign-in shortly after the person signed in. Asking before anything is
// deleted spares them a half-finished deletion.
const RECENT_SIGN_IN_MS = 4 * 60_000;

export type DeleteAccountResult =
  | { ok: true }
  | { ok: false; needsRecentSignIn?: boolean; /** The session was no good and the person has been signed out. */ signedOut?: boolean; error?: string };

/**
 * Deletes the person's account: first their data on our server, then their sign-in at Firebase, then
 * the session on this phone. In that order, so that if the sign-in cannot be deleted they can still
 * sign in and try again (the other way round would leave data with nobody able to reach it).
 * A Microsoft account has no Firebase sign-in to delete: the data and this phone's session go, and
 * their Microsoft account itself is untouched.
 *
 * `needsRecentSignIn` means the person must sign in again and retry straight away.
 */
export async function deleteAccount(serverUrl: string): Promise<DeleteAccountResult> {
  if (!session) return { ok: false, error: "You are not signed in." };
  const provider = session.provider;

  if (provider === "firebase") {
    const signedInAt = authTimeMs(session.idToken);
    if (signedInAt !== undefined && Date.now() - signedInAt > RECENT_SIGN_IN_MS) return { ok: false, needsRecentSignIn: true };
  }

  const token = await getIdToken();
  if (!token) return { ok: false, signedOut: true, error: "Your session has ended. Sign in again, then try again." };

  try {
    // Not authFetch: a 401 there signs the person out, and here "account_deleted" means a retry of
    // a deletion that already went through, which should carry on to the next step.
    const res = await fetch(`${serverUrl}/api/me`, { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      const body = await res.json().catch(() => ({}));
      if (body?.error !== "account_deleted") {
        await signOut();
        return { ok: false, signedOut: true, error: "Your session has ended. Sign in again, then try again." };
      }
    } else if (!res.ok) {
      return { ok: false, error: "We could not delete your account right now. Try again in a moment." };
    }
  } catch {
    return { ok: false, error: "Could not reach the server. Check your connection and try again." };
  }

  if (provider === "firebase") {
    try {
      await firebasePost("accounts:delete", { idToken: token });
    } catch (err: any) {
      // Already gone counts as done.
      if (err?.code !== "USER_NOT_FOUND") {
        if (err?.code === "CREDENTIAL_TOO_OLD_LOGIN_REQUIRED") return { ok: false, needsRecentSignIn: true };
        return { ok: false, error: "Your data was deleted, but we could not remove your sign-in. Try again." };
      }
    }
  }

  await signOut();
  return { ok: true };
}

/** A valid ID token, refreshed first if it is about to expire. Returns undefined when signed out. */
export async function getIdToken(): Promise<string | undefined> {
  if (!authConfigured || !session) return undefined;
  if (Date.now() < session.expiresAt - EXPIRY_MARGIN_MS) return session.idToken;
  if (!session.refreshToken) {
    await signOut();
    return undefined;
  }
  if (session.provider === "firebase") {
    try {
      const next = await refreshFirebase(session.refreshToken);
      await persist(next);
      publish(next);
      return next.idToken;
    } catch (err: any) {
      if (err?.rejected) await signOut();
      return undefined;
    }
  }
  try {
    const discovery = await getDiscovery();
    const tokens = await AuthSession.refreshAsync(
      { clientId: AUTH_CLIENT_ID, refreshToken: session.refreshToken, scopes: SCOPES },
      discovery
    );
    const next = toSession(tokens, session);
    await persist(next);
    publish(next);
    return next.idToken;
  } catch (err: any) {
    // Only a rejected refresh token means "signed out"; a network blip keeps the session for the next try.
    if (err?.code === "invalid_grant" || err?.code === "invalid_request") await signOut();
    return undefined;
  }
}

/** fetch() that adds the bearer token when sign-in is configured. A 401 means the session is no good, so sign out. */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  if (!authConfigured) return fetch(input, init);
  const token = await getIdToken();
  const headers = { ...(init.headers as Record<string, string> | undefined), ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401 && token) await signOut();
  return res;
}

export function useAuthSession() {
  const [current, setCurrent] = useState<AuthSessionInfo | null>(session);
  const [ready, setReady] = useState(!authConfigured || loaded);

  useEffect(() => {
    listeners.add(setCurrent);
    if (!authConfigured) return () => void listeners.delete(setCurrent);
    loadStoredSession().finally(() => {
      setCurrent(session);
      setReady(true);
    });
    return () => void listeners.delete(setCurrent);
  }, []);

  return { session: current, ready };
}
