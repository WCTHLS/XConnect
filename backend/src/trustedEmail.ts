import type { JWTPayload } from "jose";

/**
 * Whether the email in a verified token may be used to grant admin rights. Anyone can register
 * an email/password account with any address (Firebase does not check the mailbox exists), so an
 * address only counts once the provider says its owner proved they hold it.
 *
 *  - Firebase tokens carry `email_verified`: true for Google sign-in, false for an email/password
 *    account until its link is clicked.
 *  - Microsoft tokens do not vouch for the email claim (a tenant admin can set any address on a
 *    user), so it counts only when the token came from the one tenant the company trusts
 *    (`trustedTenantId`, the single-tenant app registration), or when Microsoft itself marks the
 *    domain as verified (`xms_edov`).
 */
export type AdminAccess = {
  /** On the admin list with an email the provider vouches for. */
  isAdmin: boolean;
  /** On the admin list, but the email is not proven yet (for example an unverified password account). */
  pending: boolean;
};

/**
 * Whether this request's token makes its holder an admin. The admin list is the only source of
 * truth: it is worked out from the token on every request, never read back from a stored flag, so
 * taking an address off the list (or an email going unverified) removes access on the next request.
 */
export function adminAccess(
  email: string | undefined,
  payload: JWTPayload,
  provider: "firebase" | "oidc",
  adminEmails: ReadonlySet<string>,
  trustedTenantId?: string
): AdminAccess {
  const onList = Boolean(email && adminEmails.has(email.toLowerCase()));
  const isAdmin = onList && emailIsTrusted(payload, provider, trustedTenantId);
  return { isAdmin, pending: onList && !isAdmin };
}

export function emailIsTrusted(
  payload: JWTPayload,
  provider: "firebase" | "oidc",
  trustedTenantId?: string
): boolean {
  if (provider === "firebase") return payload.email_verified === true;
  if (payload.email_verified === true || payload.xms_edov === true || payload.xms_edov === "1") return true;
  return Boolean(trustedTenantId && typeof payload.tid === "string" && payload.tid.toLowerCase() === trustedTenantId.toLowerCase());
}
