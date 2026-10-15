/**
 * Checks which tokens may use their email to become an admin.
 *
 *   pnpm exec tsx src/test_trusted_email.ts
 *
 * Anyone can register an email/password account with any address, so an address on the admin list
 * only counts once the sign-in provider says its owner proved they hold it.
 */
import { adminAccess, emailIsTrusted } from "./trustedEmail.js";

let failed = 0;
function check(name: string, ok: boolean) {
  console.log(`  ${ok ? "ok " : "FAIL"} ${name}`);
  if (!ok) failed++;
}

const TENANT = "11111111-2222-3333-4444-555555555555";

check("Firebase: verified email (Google sign-in) is trusted", emailIsTrusted({ email_verified: true }, "firebase"));
check("Firebase: unverified email/password account is not", !emailIsTrusted({ email_verified: false }, "firebase"));
check("Firebase: missing claim is not", !emailIsTrusted({}, "firebase"));
check("Firebase: a string 'true' is not", !emailIsTrusted({ email_verified: "true" }, "firebase"));
check("Firebase: the trusted tenant setting does not apply", !emailIsTrusted({ tid: TENANT }, "firebase", TENANT));

check("Microsoft: the company tenant is trusted", emailIsTrusted({ tid: TENANT }, "oidc", TENANT));
check("Microsoft: tenant id compares case-insensitively", emailIsTrusted({ tid: TENANT.toUpperCase() }, "oidc", TENANT));
check("Microsoft: another tenant is not", !emailIsTrusted({ tid: "99999999-2222-3333-4444-555555555555" }, "oidc", TENANT));
check("Microsoft: no tenant configured means no tenant is trusted", !emailIsTrusted({ tid: TENANT }, "oidc"));
check("Microsoft: no tenant claim is not trusted", !emailIsTrusted({}, "oidc", TENANT));
check("Microsoft: a domain Microsoft verified (xms_edov) is trusted", emailIsTrusted({ xms_edov: true }, "oidc"));
check("Microsoft: xms_edov sent as '1' is trusted", emailIsTrusted({ xms_edov: "1" }, "oidc"));
check("Microsoft: xms_edov false is not", !emailIsTrusted({ xms_edov: false }, "oidc"));

// Admin status is worked out from the token and the list on every request.
const list = new Set(["admin@x.com", "boss@x.com"]);
const googleToken = { email_verified: true };
const passwordToken = { email_verified: false };

const onList = adminAccess("admin@x.com", googleToken, "firebase", list);
check("on the list with a verified email: admin", onList.isAdmin && !onList.pending);
check("the address match ignores case", adminAccess("Admin@X.com", googleToken, "firebase", list).isAdmin);
check("not on the list: not admin, not pending", !adminAccess("who@x.com", googleToken, "firebase", list).isAdmin && !adminAccess("who@x.com", googleToken, "firebase", list).pending);
const unverified = adminAccess("admin@x.com", passwordToken, "firebase", list);
check("on the list but unverified: not admin, pending verification", !unverified.isAdmin && unverified.pending);
check("no email in the token: not admin", !adminAccess(undefined, googleToken, "firebase", list).isAdmin);

const afterRemoval = new Set(["boss@x.com"]);
check(
  "removed from the list: the same verified token is no longer admin (demotion)",
  adminAccess("admin@x.com", googleToken, "firebase", list).isAdmin && !adminAccess("admin@x.com", googleToken, "firebase", afterRemoval).isAdmin
);
check(
  "an empty list makes nobody admin",
  !adminAccess("admin@x.com", googleToken, "firebase", new Set()).isAdmin
);
check(
  "Microsoft from another tenant on the list: not admin, pending",
  (() => {
    const r = adminAccess("admin@x.com", { tid: "other" }, "oidc", list, TENANT);
    return !r.isAdmin && r.pending;
  })()
);
check("Microsoft from the company tenant on the list: admin", adminAccess("admin@x.com", { tid: TENANT }, "oidc", list, TENANT).isAdmin);

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\n✅ All trusted-email checks passed.");
