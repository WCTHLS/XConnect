import type { NextFunction, Request, Response } from "express";
import { createRemoteJWKSet, decodeJwt, jwtVerify, type JWTPayload } from "jose";
import { db, schema } from "./db/index.js";

export type AuthUser = {
  id: string;
  email?: string;
  /** What to show: the person's chosen name if they set one, otherwise the account's. */
  name?: string;
  /** The name the login provider gave, kept so the UI can offer it as the fallback. */
  accountName?: string;
  isAdmin: boolean;
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
async function verifyToken(token: string): Promise<JWTPayload> {
  const verifiers = await loadVerifiers();
  // Unverified read, used only to pick a verifier — the signature check below is what makes the
  // issuer trustworthy, and it is re-checked against the verified payload afterwards.
  const claimedIssuer = decodeJwt(token).iss;
  const verifier = claimedIssuer && verifiers.find((v) => v.issuerMatches(claimedIssuer));
  if (!verifier) throw new Error(`no configured provider issued this token (iss: ${claimedIssuer})`);

  const { payload } = await jwtVerify(token, verifier.jwks, { audience: verifier.audience });
  if (!payload.iss || !verifier.issuerMatches(payload.iss)) throw new Error("issuer mismatch");
  return payload;
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
const userCache = new Map<string, { user: AuthUser; at: number }>();

/** Upserts the person's row at most every USER_REFRESH_MS so authenticated polling never hits the DB per request. */
async function resolveUser(payload: JWTPayload): Promise<AuthUser> {
  const id = claimString(payload, "oid", "sub");
  if (!id) throw new Error("token has no subject");
  const email = claimString(payload, "email", "emails", "preferred_username", "upn");
  const name = claimString(payload, "name") ?? email?.split("@")[0];
  const allowlisted = Boolean(email && ADMIN_EMAILS.has(email.toLowerCase()));

  const cached = userCache.get(id);
  if (cached && Date.now() - cached.at < USER_REFRESH_MS) return cached.user;

  let isAdmin = allowlisted;
  let preferredName: string | undefined;
  if (db) {
    const now = new Date();
    const [row] = await db
      .insert(schema.users)
      .values({ id, email, displayName: name, isAdmin: allowlisted, firstSeenAt: now, lastSeenAt: now })
      .onConflictDoUpdate({
        target: schema.users.id,
        // Never downgrade an admin set directly in the database; only the allowlist can add one here.
        set: allowlisted
          ? { email, displayName: name, lastSeenAt: now, isAdmin: true }
          : { email, displayName: name, lastSeenAt: now }
      })
      .returning({ isAdmin: schema.users.isAdmin, preferredName: schema.users.preferredName });
    isAdmin = row?.isAdmin ?? allowlisted;
    preferredName = row?.preferredName ?? undefined;
  }

  const user: AuthUser = { id, email, name: preferredName ?? name, accountName: name, isAdmin };
  userCache.set(id, { user, at: Date.now() });
  return user;
}

/** Drops a cached user so a just-changed name is visible on the very next request. */
export function forgetCachedUser(id: string) {
  userCache.delete(id);
}

export async function authenticate(request: Request, response: Response, next: NextFunction) {
  if (!authEnabled) return next();
  if (request.path === "/health" || request.path === "/api/health") return next();

  const header = request.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return response.status(401).json({ error: "unauthenticated" });

  try {
    request.user = await resolveUser(await verifyToken(token));
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
