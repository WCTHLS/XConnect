# Microsoft sign-in with Entra ID: setup guide

How to set up the **Sign in with Microsoft** button for XConnect. Entra is used for this one
thing only. Email/password and Google sign-in go through Firebase and are set up separately.
For how sign-in works end to end, see [AUTH_IMPLEMENTATION.md](AUTH_IMPLEMENTATION.md).

This guide uses an ordinary **Entra ID app registration**, not Entra External ID (a separate
customer tenant). The app and server already support both. The only difference is the authority
URL, so you can move to External ID later without code changes (see the last section).

---

## What you need to create

One thing: **one app registration**. There is no client secret, no second app, no Graph
permissions and no user flows.

XConnect has a single mobile app. Who is an admin is decided by the server's admin email list
(`ADMIN_EMAILS`), not by a separate app registration or sign-in flow.

| Where it goes | Value | App setting |
|---|---|---|
| App | Application (client) ID | `AUTH_CLIENT_ID` in `apps/mobile/src/config/authConfig.ts` |
| App | Authority URL | `AUTH_AUTHORITY` in the same file |
| Server | Authority URL | `authAuthority` (Bicep) / `AUTH_AUTHORITY` |
| Server | Application (client) ID | `authAudience` (Bicep) / `AUTH_AUDIENCE` |
| Server | Admin email addresses | `adminEmails` (Bicep) / `ADMIN_EMAILS` |

The client ID and the authority are public identifiers, not secrets. The app and the server
must use the **same** values.

---

## Step 1. Choose who can sign in

This decides the account type for the registration and the authority URL.

| Who signs in | Supported account types | Authority URL |
|---|---|---|
| Anyone with a work or school or personal Microsoft account | Any organizational directory **and personal Microsoft accounts** | `https://login.microsoftonline.com/common/v2.0` |
| Staff of one company only | Accounts in this organizational directory only (single tenant) | `https://login.microsoftonline.com/<tenant-id>/v2.0` |

The personal trial uses the first row. For the company deployment, decide with IT. A
single-tenant registration in the company tenant is the usual choice when only company staff
sign in.

The account type and the authority must match. A single-tenant registration with the `common`
authority fails at sign-in (see Troubleshooting).

---

## Step 2. Register the app

Use the **company's** tenant for the company deployment. Check the directory in the Azure portal
before you start (top right, Switch directory).

1. Go to **Microsoft Entra ID**, then **App registrations**, then **+ New registration**.
2. Fill in:

   | Setting | Value |
   |---|---|
   | Name | `XConnect Mobile` |
   | Supported account types | From step 1 |
   | Redirect URI | Leave empty for now (set in step 3) |

3. Click **Register**.
4. On the **Overview** page, copy:
   - **Application (client) ID**. This is `AUTH_CLIENT_ID` and `authAudience`.
   - **Directory (tenant) ID**. You need it only for a single-tenant authority URL.

---

## Step 3. Add the mobile redirect

1. Open the registration, then **Authentication**, then **+ Add a platform**.
2. Choose **Mobile and desktop applications**. Do not choose Web or Single-page application.
3. Under **Custom redirect URIs**, add exactly:

   ```text
   xconnect://auth
   ```

   This is the app's URL scheme (`"scheme": "xconnect"` in `apps/mobile/app.json`) plus the
   path `auth`, as set by `AUTH_REDIRECT_SCHEME` in `authConfig.ts`.
4. Click **Configure**.
5. Still on **Authentication**, scroll to **Advanced settings** and set
   **Allow public client flows** to **Yes**. Save.

   The app signs in with the authorization code flow and PKCE and has no client secret, so this
   setting is required. Without it the token request fails (see Troubleshooting).

---

## Step 4. Check the API permissions

The app asks for `openid profile email offline_access`. On **API permissions**, the default
**Microsoft Graph, User.Read (Delegated)** is enough. Nothing else is needed.

If the company tenant restricts user consent, people may see "Need admin approval" at first
sign-in. In that case an admin clicks **Grant admin consent for <tenant>** on this page once.

---

## Step 5. Make sure the email is in the token

The server reads the person's email from the ID token to recognize admins. It tries the
`email`, `emails`, `preferred_username` and `upn` claims, in that order.

For work accounts, `preferred_username` normally contains the sign-in address, which is fine.
Personal Microsoft accounts do not always include `email` by default, so add it:

1. Open the registration, then **Token configuration**.
2. **+ Add optional claim**, token type **ID**, tick **email**, then **Add**.
3. If asked to turn on the Microsoft Graph `email` permission, accept.

---

## Step 6. Point the app and server at it

### The mobile app

Edit [apps/mobile/src/config/authConfig.ts](../apps/mobile/src/config/authConfig.ts):

```ts
export const AUTH_AUTHORITY = "https://login.microsoftonline.com/<tenant-id or common>/v2.0";
export const AUTH_CLIENT_ID = "<Application (client) ID>";
export const AUTH_REDIRECT_SCHEME = "xconnect";
```

These are compiled into the app, so **build a new app** after changing them. A reload is not
enough for a release build. Leaving `AUTH_CLIENT_ID` empty hides the Microsoft button.

### The server (Bicep)

In the deployment parameter file (for example `infra/company.local.bicepparam`, which is
gitignored):

```text
param authAuthority = 'https://login.microsoftonline.com/<tenant-id or common>/v2.0'
param authAudience  = '<Application (client) ID>'
param adminEmails   = 'admin1@company.com,admin2@company.com'
```

Then deploy as usual. Changing these environment variables creates a new revision, so the API
restarts briefly. Do it outside an event.

### The server (an app that is already running)

```powershell
az containerapp update -n <app> -g <resource group> --set-env-vars AUTH_AUTHORITY="<authority>" AUTH_AUDIENCE="<client id>" ADMIN_EMAILS="<emails>"
```

To remove them again (this turns Microsoft sign-in off on the server):

```powershell
az containerapp update -n <app> -g <resource group> --remove-env-vars AUTH_AUTHORITY AUTH_AUDIENCE
```

Sign-in is on for the server when either `FIREBASE_PROJECT_ID` **or** both `AUTH_AUTHORITY` and
`AUTH_AUDIENCE` are set. Load tests need sign-in **off**, so do not run them against a server
with these values set.

---

## Step 7. Test it

1. Open the app, then **Sign in with Microsoft**, and pick an account.
2. You should return to the app signed in.
3. In the server log you should see no `401` lines. If the email is in `adminEmails`, the admin
   tabs appear.
4. Confirm directly if you want:
   `GET <server>/api/me` with the token returns the user's email and `isAdmin`.

---

## Troubleshooting

| Message or symptom | Cause and fix |
|---|---|
| `AADSTS50011` redirect URI mismatch | The redirect URI in step 3 is missing or different. It must be exactly `xconnect://auth`, under **Mobile and desktop applications**. |
| `AADSTS700016` application not found in the directory | The authority points at a different tenant than the registration. Use the right tenant id, or recreate the registration in the intended tenant. |
| `AADSTS50194` not configured as multi-tenant | The registration is single-tenant but the authority is `common`. Use the tenant-specific authority, or change the account type. |
| `AADSTS7000218` or `AADSTS9002327` client secret or assertion required | **Allow public client flows** is not set to Yes (step 3). |
| `AADSTS65001` or "Need admin approval" | Tenant restricts consent. An admin grants consent (step 4). |
| App shows signed in, but every API call is `401` | Server and app disagree. Check that `authAudience` equals the client ID in the app and `authAuthority` equals the app's authority. |
| Server log: `no configured provider issued this token` | The server's authority does not match the token's issuer (wrong tenant, or `common` versus a tenant id). |
| Server log: `issuer mismatch` or an audience error | `AUTH_AUDIENCE` is not the registration's client ID. |
| Signed in, but the admin tabs are missing | The email in the token is not in `adminEmails`, or the token has no email. Check step 5, and compare the address (case does not matter). |
| Microsoft button missing | `AUTH_CLIENT_ID` in the app is empty. |

---

## Moving to Entra External ID later

If external people (not company staff) need to sign up themselves, use an External ID
(customer) tenant instead:

1. Create a **Customer** tenant and note its subdomain and tenant id.
2. Register the same app there: **Mobile and desktop applications**, redirect
   `xconnect://auth`, public client flows on.
3. Create a **Sign up and sign in** user flow with Email with password, add the app to it, and
   make sure the email address is included in the token.
4. Change only the authority, in the app and on the server:

   ```text
   https://<subdomain>.ciamlogin.com/<tenant-id>/v2.0
   ```

No server code changes are needed. The server reads the real issuer from the authority's
discovery document. External ID is free for the first 50,000 monthly active users.

Personal Microsoft accounts and accounts from other organizations cannot sign in to an
External ID tenant. Only accounts created in that tenant can.
