import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from "jose";
import { db, schema } from "./db/index.js";
import { redis } from "./redis/index.js";
import { adminAccess } from "./trustedEmail.js";

export type AuthUser = {
  id: string;
  email?: string;
  /** What to show: the person's chosen name if they set one, otherwise the account's. */
  name?: string;
  /** The name the login provider gave, kept so the UI can offer it as the fallback. */
  accountName?: string;
  isAdmin: boolean;
  /**
   * True when the email is on the admin list but the provider has not vouched for it yet (an
   * unverified password account), so the app can say "verify your email" instead of "not an admin".
   */
  adminPendingVerification?: boolean;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/**
 * Two sign-in providers, both active at once, each enabled by its own env vars. A token is routed
 * to whichever one issued it, so a Firebase (email/password, Google) and a Microsoft sign-in are
 * equally valid. With neither configured, auth is off and every request is allowed, the same
 * "unset means POC mode" switch DATABASE_URL uses.
 *
 *  - Firebase Auth: set FIREBASE_PROJECT_ID. Tokens are checked against Google's published keys.
 *  - Microsoft (or any OpenID provider): set AUTH_AUTHORITY to its authority, e.g.
 *    https://login.microsoftonline.com/common/v2.0 for work and personal Microsoft accounts, or an
 *    Entra External ID tenant (https://<subdomain>.ciamlogin.com/<tenant-id>/v2.0) later. Set
 *    AUTH_AUDIENCE to the app registration's client ID, which is what the app's ID token is issued for.
 */
const AUTHORITY = process.env.AUTH_AUTHORITY?.replace(/\/+$/, "");
const AUDIENCE = process.env.AUTH_AUDIENCE;
const ADMIN_EMAILS = new Set(
  (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
);

/** The company's Entra tenant id: Microsoft sign-ins from it may become admin by email. Unset means none may. */
const ADMIN_TENANT_ID = process.env.ADMIN_TENANT_ID?.trim() || undefined;

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

export const authEnabled = Boolean(FIREBASE_PROJECT_ID || (AUTHORITY && AUDIENCE));

type Verifier = {
  name: string;
  audience: string;
  jwks: ReturnType<typeof createRemoteJWKSet>;
  issuerMatches: (issuer: string) => boolean;
};

let verifiersPromise: Promise<Verifier[]> | undefined;

/**
 * A multi-tenant Microsoft authority advertises the literal template
 * "https://login.microsoftonline.com/{tenantid}/v2.0" — every real token carries its signer's own
 * tenant GUID there, so the shape has to be matched rather than the string. A single-tenant
 * authority (Entra External ID) advertises its real issuer, which is compared exactly.
 */
function issuerMatcher(discovered: string): (issuer: string) => boolean {
  if (!discovered.includes("{tenantid}")) return (issuer) => issuer === discovered;
  const pattern = new RegExp(
    `^${discovered.split("{tenantid}").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[0-9a-fA-F-]{36}")}$`
  );
  return (issuer) => pattern.test(issuer);
}

function loadVerifiers(): Promise<Verifier[]> {
  verifiersPromise ??= (async () => {
    const verifiers: Verifier[] = [];
    if (FIREBASE_PROJECT_ID) {
      const issuer = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
      verifiers.push({
        name: "firebase",
        audience: FIREBASE_PROJECT_ID,
        jwks: createRemoteJWKSet(new URL(FIREBASE_JWKS_URL)),
        issuerMatches: (candidate) => candidate === issuer
      });
    }
    if (AUTHORITY && AUDIENCE) {
      const res = await fetch(`${AUTHORITY}/.well-known/openid-configuration`);
      if (!res.ok) throw new Error(`OpenID discovery failed (${res.status})`);
      const config = (await res.json()) as { issuer: string; jwks_uri: string };
      verifiers.push({
        name: "oidc",
        audience: AUDIENCE,
        jwks: createRemoteJWKSet(new URL(config.jwks_uri)),
        issuerMatches: issuerMatcher(config.issuer)
      });
    }
    return verifiers;
  })().catch((err) => {
    verifiersPromise = undefined; // retry on the next request instead of caching a failure
    throw err;
  });
  return verifiersPromise;
}

/** Verifies against whichever configured provider issued the token. Throws if none did. */
async function verifyToken(token: string): Promise<{ payload: JWTPayload; provider: "firebase" | "oidc" }> {
  const verifiers = await loadVerifiers();
  // Unverified read, used only to pick a verifier — the signature check below is what makes the
  // issuer trustworthy, and it is re-checked against the verified payload afterwards.
  const claimedIssuer = decodeJwt(token).iss;
  const verifier = claimedIssuer && verifiers.find((v) => v.issuerMatches(claimedIssuer));
  if (!verifier) throw new Error(`no configured provider issued this token (iss: ${claimedIssuer})`);

  const { payload } = await jwtVerify(token, verifier.jwks, { audience: verifier.audience });
  if (!payload.iss || !verifier.issuerMatches(payload.iss)) throw new Error("issuer mismatch");
  return { payload, provider: verifier.name as "firebase" | "oidc" };
}

function claimString(payload: JWTPayload, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value) return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  }
  return undefined;
}

const USER_REFRESH_MS = 5 * 60 * 1000;
const USER_CACHE_PREFIX = "auth:profile:";

/** What is cached per person: who they are, never what they may do (admin is worked out per request). */
type Profile = Pick<AuthUser, "id" | "email" | "name" | "accountName">;

/**
 * L1 cache — checked first on every authenticated request, zero network cost. Redis (below) is
 * an L2 behind it: surviving a restart means the first request after boot can still skip the
 * Postgres upsert, instead of every cache being cold again the moment the process restarts.
 */
const userCache = new Map<string, { profile: Profile; at: number }>();

async function getCachedProfile(id: string): Promise<Profile | undefined> {
  const cached = userCache.get(id);
  if (cached && Date.now() - cached.at < USER_REFRESH_MS) return cached.profile;
  if (!redis) return undefined;
  const raw = await redis.get(`${USER_CACHE_PREFIX}${id}`);
  if (!raw) return undefined;
  const parsed = JSON.parse(raw) as Profile;
  const profile: Profile = { id: parsed.id, email: parsed.email, name: parsed.name, accountName: parsed.accountName };
  userCache.set(id, { profile, at: Date.now() });
  return profile;
}

function setCachedProfile(id: string, profile: Profile) {
  userCache.set(id, { profile, at: Date.now() });
  redis
    ?.set(`${USER_CACHE_PREFIX}${id}`, JSON.stringify(profile), "PX", USER_REFRESH_MS)
    .catch((err) => console.error("[redis] failed to cache user:", err));
}

/**
 * Upserts the person's row at most every USER_REFRESH_MS so authenticated polling never hits the DB
 * per request. Admin status is not part of that: it comes from the admin list and this token on
 * every request (see adminAccess), so a change to the list takes effect immediately.
 */
async function resolveUser(
  payload: JWTPayload,
  provider: "firebase" | "oidc",
  persist: boolean = true
): Promise<AuthUser> {
  const id = claimString(payload, "oid", "sub");
  if (!id) throw new Error("token has no subject");
  const email = claimString(payload, "email", "emails", "preferred_username", "upn");
  const name = claimString(payload, "name") ?? email?.split("@")[0];
  // Only an email its owner has proved may grant admin: see trustedEmail.ts.
  const access = adminAccess(email, payload, provider, ADMIN_EMAILS, ADMIN_TENANT_ID);
  const withAccess = (profile: Profile): AuthUser => ({
    ...profile,
    isAdmin: access.isAdmin,
    ...(access.pending ? { adminPendingVerification: true } : {})
  });

  // A probe (see authenticate) answers who the token is and what it may do without writing a row
  // or filling the cache, so checking an account that is about to be refused leaves no trace.
  if (!persist) return withAccess({ id, email, name, accountName: name });

  const cached = await getCachedProfile(id);
  if (cached) return withAccess(cached);

  let preferredName: string | undefined;
  if (db) {
    const now = new Date();
    const [row] = await db
      .insert(schema.users)
      .values({ id, email, displayName: name, isAdmin: access.isAdmin, firstSeenAt: now, lastSeenAt: now })
      // is_admin is written as a record for reports only; access never reads it back.
      .onConflictDoUpdate({
        target: schema.users.id,
        set: { email, displayName: name, lastSeenAt: now, isAdmin: access.isAdmin }
      })
      .returning({ preferredName: schema.users.preferredName });
    preferredName = row?.preferredName ?? undefined;
  }

  const profile: Profile = { id, email, name: preferredName ?? name, accountName: name };
  setCachedProfile(id, profile);
  return withAccess(profile);
}

/** Drops a cached user so a just-changed name is visible on the very next request. */
export function forgetCachedUser(id: string) {
  userCache.delete(id);
  redis?.del(`${USER_CACHE_PREFIX}${id}`).catch((err) => console.error("[redis] failed to drop cached user:", err));
}

/**
 * A deleted account's token stays valid for up to an hour, and resolveUser would write the person's
 * row straight back on the next request that carried it. So deleting an account leaves a marker: any
 * token issued before that moment is refused. A new sign-in produces a token issued after it, which
 * passes (Microsoft accounts can come back; a Firebase account is gone, so a new one has a new id).
 * The marker outlives a token's lifetime, then drops away by itself.
 */
const DELETED_PREFIX = "auth:deleted:";
const DELETED_TTL_MS = 2 * 60 * 60 * 1000;
const deletedUsers = new Map<string, number>();

export function markUserDeleted(id: string) {
  const now = Date.now();
  for (const [key, at] of deletedUsers) if (now - at > DELETED_TTL_MS) deletedUsers.delete(key);
  deletedUsers.set(id, now);
  redis
    ?.set(`${DELETED_PREFIX}${id}`, String(now), "PX", DELETED_TTL_MS)
    .catch((err) => console.error("[redis] failed to mark a deleted user:", err));
}

async function deletedAt(id: string): Promise<number | undefined> {
  const local = deletedUsers.get(id);
  if (local && Date.now() - local < DELETED_TTL_MS) return local;
  if (!redis) return undefined;
  const raw = await redis.get(`${DELETED_PREFIX}${id}`);
  const at = raw ? Number(raw) : NaN;
  return Number.isFinite(at) ? at : undefined;
}

export async function authenticate(request: Request, response: Response, next: NextFunction) {
  if (!authEnabled) return next();
  if (request.path === "/health" || request.path === "/api/health") return next();

  const header = request.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return response.status(401).json({ error: "unauthenticated" });

  try {
    const { payload, provider } = await verifyToken(token);
    const subject = claimString(payload, "oid", "sub");
    const removedAt = subject ? await deletedAt(subject) : undefined;
    if (removedAt !== undefined && (typeof payload.iat === "number" ? payload.iat * 1000 : 0) < removedAt) {
      return response.status(401).json({ error: "account_deleted" });
    }
    // The app sends this on the sign-in screens' admin check, before it decides to let the person in.
    const probe = request.headers["x-auth-probe"] === "1";
    request.user = await resolveUser(payload, provider, !probe);
    return next();
  } catch (err) {
    console.warn("[auth] rejected token:", err instanceof Error ? err.message : err);
    return response.status(401).json({ error: "invalid_token" });
  }
}

export function requireAdmin(request: Request, response: Response, next: NextFunction) {
  if (!authEnabled) return next();
  if (!request.user?.isAdmin) return response.status(403).json({ error: "admin_only" });
  return next();
}
