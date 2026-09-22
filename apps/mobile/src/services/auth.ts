import * as AuthSession from "expo-auth-session";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { AUTH_AUTHORITY, AUTH_CLIENT_ID, AUTH_REDIRECT_SCHEME, FIREBASE_API_KEY, GOOGLE_ANDROID_CLIENT_ID } from "../config/authConfig";

WebBrowser.maybeCompleteAuthSession();

// Firebase (email/password, Google) and Microsoft run side by side; a session records which one
// signed it in, since that decides how it is refreshed.
export const emailSignInAvailable = Boolean(FIREBASE_API_KEY);
export const googleSignInAvailable = Boolean(FIREBASE_API_KEY) && Platform.OS === "android" && Boolean(GOOGLE_ANDROID_CLIENT_ID);
export const microsoftSignInAvailable = Boolean(AUTH_AUTHORITY && AUTH_CLIENT_ID);
export const authConfigured = emailSignInAvailable || microsoftSignInAvailable;

export type AuthSessionInfo = {
  provider: "firebase" | "microsoft";
  idToken: string;
  refreshToken?: string;
  expiresAt: number;
  name?: string;
  email?: string;
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

function decodeClaims(idToken: string): { name?: string; email?: string } {
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
    const claims = JSON.parse(json);
    const email = [claims.email, claims.emails, claims.preferred_username].flat().find((v) => typeof v === "string");
    return { name: typeof claims.name === "string" ? claims.name : undefined, email };
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
    throw new Error(FIREBASE_ERRORS[code.split(" ")[0]] ?? "Something went wrong. Try again.");
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
    const discovery = await AuthSession.fetchDiscoveryAsync("https://accounts.google.com");
    // Android OAuth clients only accept a redirect built from their own client ID.
    const redirectUri = `com.googleusercontent.apps.${GOOGLE_ANDROID_CLIENT_ID.replace(".apps.googleusercontent.com", "")}:/oauthredirect`;
    const request = new AuthSession.AuthRequest({
      clientId: GOOGLE_ANDROID_CLIENT_ID,
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
        clientId: GOOGLE_ANDROID_CLIENT_ID,
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
      usePKCE: true
    });
    const result = await request.promptAsync(discovery);
    if (result.type !== "success") {
      return { ok: false, error: result.type === "cancel" || result.type === "dismiss" ? undefined : "Microsoft sign-in failed" };
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

export async function signOut() {
  await persist(null);
  publish(null);
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
