# Email and Google sign-in with Firebase: company deployment guide

How to set up **email/password** and **Sign in with Google** for the company's XConnect deployment.
Written for whoever is doing the go-live, and for the IT contact who owns the company's Google and
Apple accounts. Microsoft sign-in is a separate guide:
[ENTRA_MICROSOFT_SIGN_IN_SETUP.md](ENTRA_MICROSOFT_SIGN_IN_SETUP.md). How sign-in works in code:
[AUTH_IMPLEMENTATION.md](AUTH_IMPLEMENTATION.md).

**The one rule:** the company deployment gets its **own Firebase project**, owned by the company.
Development has used a personal project (`xconnect-2b9a3`). It stays the development project. Nothing
about the company's users, keys or sign-in should depend on a personal account.

---

## What this deployment needs, in plain terms

- A Firebase project (holds the accounts and checks passwords).
- Two Google OAuth clients inside it (Android and iOS) so the Google button works.
- A handful of values copied into the app and into the Azure deployment file.
- The people who sign in are the public. Nobody is invited or provisioned: an account is created the
  first time someone signs up or signs in.

How it works, briefly. The app talks to Firebase over plain web requests (no Firebase SDK). For Google,
the app opens Google's own login page, receives a Google token, and gives it to Firebase, which returns a
Firebase token. The app sends that token to the XConnect server on every request, and the server verifies
it against Google's public keys and checks it was issued for **its own Firebase project id**. The server
stores nothing but the person's row, created on first sign-in.

---

## Who does what

| Who | What |
|---|---|
| **The company (IT or a project owner)** | Provides a company Google account or Google Workspace to own the project, billing details if asked, a second owner, and the Apple Developer account for iOS. Decides the app's public name and a support mailbox. |
| **You (deployment)** | Creates the Firebase project and the Google clients in that account, copies the values into the app and the Azure parameter file, builds the app, runs the tests below. |
| **Whoever holds the release signing key** | Creates, stores and backs up the Android release keystore (see Step 5). |

### Send IT this first

> For the XConnect company deployment I need, for sign-in and push notifications:
> 1. A company-owned Google account (or a Google Workspace user or group) that will own a new Firebase /
>    Google Cloud project, and a second person added as Owner. If your Google Cloud organization has
>    policies on creating projects or OAuth clients, please tell me who can create them.
> 2. The app's public name and a support email address (a shared mailbox, not a person) for the Google
>    consent screen, and a privacy policy URL if the company has one.
> 3. For iOS: the Apple Developer Program team and the bundle identifier we should use.
> 4. For Android: confirmation of the package name to use (currently `com.confpresence.zero`, which is
>    fixed for good once the app is published to the Play Store), and who will hold the release signing key.

---

## Decide these before you start

| Decision | Why it matters |
|---|---|
| **Firebase project id** (for example `xconnect-wct`) | Permanent and globally unique. It is also what the server checks every token against. |
| **Android package name** | Currently `com.confpresence.zero`. Cannot change after the first Play Store release, and it ties the Android OAuth client and `google-services.json` to it. Use the company's own name now if you want one. |
| **iOS bundle identifier** | Currently `com.thaqib.confpresencezeropoc`, a development value. Set the company's own in `apps/mobile/app.json` before creating the iOS client. |
| **One app build per Firebase project** | The ids are constants in `authConfig.ts`, so a build talks to exactly one project. A test build pointing at the dev project and a company build need different values. Keep them straight. |

---

## Where Firebase fits in the Azure deployment order

The server needs only the project id, so the Firebase work can be done before or after the Azure deploy.
Recommended order:

1. Deploy the Azure stack **without sign-in** first (leave `firebaseProjectId`, `authAuthority`,
   `authAudience` and `adminEmails` out of `infra/company.local.bicepparam`). Run the migrations and the
   load tests. **Load tests need sign-in off.**
2. Create the Firebase project and Google clients (below).
3. Add `firebaseProjectId` and `adminEmails` to the parameter file and deploy again. Sign-in is now on for
   the server (an API restart, so do it outside an event).
4. Build the app with the company server URL and the company ids, and test.

---

## Step 1. Create the Firebase project (company-owned)

1. Sign in to the [Firebase console](https://console.firebase.google.com) as the **company account**.
2. **Add project.** Use the project id you decided on. Google Analytics is not needed.
3. **Project settings, Users and permissions:** add the second **Owner**, and any others who should manage
   it. Use named accounts so access can be removed when people leave.
4. The free Spark plan covers email/password and Google sign-in. Check Firebase's current pricing page
   before launch.

---

## Step 2. Turn on the sign-in methods

1. **Authentication, Get started, Sign-in method.**
2. Enable **Email/Password**. Leave **Email link (passwordless sign-in)** off.
3. Enable **Google.** Set the public-facing name and the support email, then save.
4. **Authentication, Settings, User account linking:** select **Link accounts that use the same email**.
   One person who uses a password and Google then has one account.
5. **Authentication, Settings, Sign-up quota:** see the next section.

---

## Event-day sign-in volume: check this before launch

Firebase limits how many accounts can be **created from one IP address in an hour**. At a venue, hundreds
of people can share **one public IP** (the venue's Wi-Fi), and a room that fills at the start of a session
is exactly when many of them create accounts.

- Open **Authentication, Settings, Sign-up quota** and read the current limit and whether you can raise it
  for an event (it can usually be increased on request or temporarily). I could not check today's values,
  so treat the number as something to confirm, not assume.
- Reduce the load: the limit is on creating accounts, so people who already have one are much less likely
  to hit it when they only **sign in** (confirm Firebase's current sign-in limits too). Encourage accounts to
  be created **before** the event.
- Test it: create 50 or more accounts quickly from one network and see whether sign-ups start failing
  with `TOO_MANY_ATTEMPTS_TRY_LATER`.

---

## Step 3. Web API key and project id

**Project settings, General:** copy the **Project ID** and the **Web API Key**.

Restrict the key in the [Google Cloud console](https://console.cloud.google.com) (the same project):
**APIs and services, Credentials, the key, API restrictions, Restrict key**, allowing only **Identity
Toolkit API** and **Token Service API**. Do **not** add Android or iOS application restrictions: the app
calls these APIs with plain web requests, which carry no app identity, and such a restriction would block
every sign-in.

---

## Step 4. Google consent screen and OAuth clients

In the Google Cloud console, in the same project: **APIs and services**.

### Consent screen (once)
- User type **External** (the public signs in).
- App name, support email (the shared mailbox), developer contact. Add the **privacy policy URL** if the
  company has one. The App Store and Play Store will ask for one anyway.
- The scopes the app requests are the basic `openid`, `profile` and `email`, which need no Google review.
- **Publish the app ("In production").** While it stays in "Testing", only listed test users can sign in
  and their sessions expire after seven days. This is the most common cause of "works for me, not for them".

### Android client
- **Create credentials, OAuth client ID, Android.** Package name from `apps/mobile/app.json`.
- **SHA-1 fingerprint** of the key the shipped app is signed with: see Step 5.
- The app uses a custom redirect scheme built from the client id
  (`com.googleusercontent.apps.<id>:/oauthredirect`). If Google rejects sign-in with "custom URI scheme
  not enabled", turn on **Enable custom URI scheme** in the client's Advanced settings.

### iOS client
- **OAuth client ID, iOS.** Bundle ID: the company's, as set in `apps/mobile/app.json`.

Both clients must be in the **same Google Cloud project as Firebase**. A client from another project is
refused by Firebase unless it is added under Authentication, Sign-in method, Google, **Safelist client IDs
from external projects**.

---

## Step 5. The Android signing key (do not skip)

Today's release builds are signed with the **debug keystore** in the repo
(`apps/mobile/android/app/build.gradle`). Its SHA-1 is
`5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`, which the personal project's client uses. That
is fine for testing and **not acceptable for anything handed to the public**: the debug key is public
knowledge, and the app can never be updated if you later sign it with a different key without Play App
Signing in place.

For the company release:
1. **Create a release keystore** and store it, and its passwords, in the company's secret store, with a
   backup. Losing it means a build users cannot update over.
2. Configure the release build to sign with it, instead of the debug key.
3. Register that key's SHA-1 on the Android OAuth client. If you use **Play App Signing**, also register the
   SHA-1 Google shows in Play Console, App integrity, because that is the key users' phones actually see.
4. Keep the debug SHA-1 on the client too if testers still install debug or test builds.

A build signed with a fingerprint that is not registered fails Google sign-in, even though everything else is
right. A fingerprint is read with `keytool -list -v -keystore <file> -alias <alias>`.

---

## Step 6. Put the values in place

### The app: [apps/mobile/src/config/authConfig.ts](../apps/mobile/src/config/authConfig.ts)
```ts
export const FIREBASE_API_KEY = "<Web API key>";
export const GOOGLE_ANDROID_CLIENT_ID = "<Android client id>.apps.googleusercontent.com";
export const GOOGLE_IOS_CLIENT_ID = "<iOS client id>.apps.googleusercontent.com";
```
An empty id hides that platform's Google button. The values are public identifiers, compiled into the app.
Also set the company server URL in `apps/mobile/App.tsx`. Then **build a new app**.

### The server: `infra/company.local.bicepparam` (gitignored)
```text
param firebaseProjectId = '<Project ID>'
param adminEmails       = 'admin1@company.com,admin2@company.com'
```
No Firebase secret goes in Azure for sign-in: the project id is not a secret and the API key lives only in the
app. Then deploy as in the main plan. On an app that is already running:
```powershell
az containerapp update -n <app> -g xconnnect --set-env-vars FIREBASE_PROJECT_ID="<Project ID>" ADMIN_EMAILS="<emails>"
```

### Android push (same project)
1. **Project settings, Your apps, Add app, Android**, with the company package name.
2. Download **`google-services.json`** into `apps/mobile/` (and `apps/mobile/android/app/`). The Android
   build already applies the Google Services Gradle plugin that makes it take effect.
3. For the server to send, the notification hub needs this project's **FCM v1 service account key**:
   **Project settings, Service accounts, Generate new private key**, pasted into the hub's Google settings in
   the Azure portal. Treat the file as a **company secret**: keep it out of git and out of chat, and know who
   can regenerate it. iOS push needs an APNs key from the Apple Developer account instead.

---

## Admins

A person is an admin when their email is on `adminEmails` **and the sign-in provider says they own that
address**. Anyone can register a password account with any address, so an unverified one never grants admin:

- **Google sign-in**: counts (Google verifies the address). Admins should sign in with Google.
- **Email and password**: counts only once the address is verified (Firebase's `email_verified` is true). A
  new password account is sent a verification email at sign-up, and Profile (or the admin screens, if the
  address is on the list) shows a "Verify your email" card with **I've verified** and **Resend email**.
- **Microsoft sign-in**: counts only when it comes from the company tenant. Set `adminTenantId` (the tenant
  id, a GUID, from the Entra overview page) alongside `adminEmails`. Left empty, no Microsoft sign-in can
  be an admin.

The list is the only source of truth, checked on every request: removing an address from `adminEmails` takes
effect as soon as the new revision is running, and nothing in the database needs editing. An admin set only
in the database (`users.is_admin`) has no effect. Before the first deploy that has this behavior, run
`select email, is_admin from users where is_admin = true;` and make sure each address is on `adminEmails`.

---

## Test it

1. Install the company build. The login screen should show **Google** and the email form.
2. Create an account with an email and password. You should land on Home.
3. Sign out and sign in with **Google**. If you use the same address, it is the same account.
4. Check `/api/me` or the server log: no `401`. An address on `adminEmails` gets the admin tabs.
5. Do this on **a build signed with the key you will ship**, not only a debug build.
6. Try the sign-up volume test from the section above.

---

## Troubleshooting

| Message or symptom | Cause and fix |
|---|---|
| No Google button | The client id for that platform is empty in `authConfig.ts`. |
| Google page: `redirect_uri_mismatch` or "invalid_request" | The client id in the app is not the client you created, or it is the wrong type (Android client on iOS, or the reverse). |
| Google: "custom URI scheme is not enabled" | Turn on **Enable custom URI scheme** in that Android client's Advanced settings. |
| Only some accounts can sign in | The consent screen is still in **Testing**. Publish it. |
| Works in the debug build, not in the shipped build | The shipping key's SHA-1 is not on the Android client. Add it, including the Play App Signing one. |
| `INVALID_IDP_RESPONSE` or "Unable to verify audience" | The Google client belongs to a different Google Cloud project than Firebase. Recreate it in the same project, or safelist it. |
| `OPERATION_NOT_ALLOWED` | Email/Password or Google is not enabled in Firebase. |
| `API_KEY_SERVICE_BLOCKED` or `API key not valid` | Wrong key, or the key's API restrictions leave out Identity Toolkit or Token Service. |
| `TOO_MANY_ATTEMPTS_TRY_LATER` on sign-up | The per-IP sign-up limit. See the volume section. |
| Signed in, but every request is `401` | The server's `FIREBASE_PROJECT_ID` is not the project that issued the token. They must match exactly. Log: `no configured provider issued this token`. |
| Push registration fails ("Make sure to complete the guide") | The build lacks `google-services.json` or the Google Services Gradle plugin. |

---

## Go-live checklist

- [ ] Company-owned Firebase project, with a second Owner.
- [ ] Email/Password and Google on; account linking set to "Link accounts"; sign-up quota confirmed for event day.
- [ ] Web API key restricted to Identity Toolkit and Token Service only.
- [ ] Consent screen **published**; privacy policy URL and support mailbox set.
- [ ] Android client with the company package name and **every SHA-1 you ship with**; iOS client with the company bundle identifier.
- [ ] **Real release keystore** created, backed up and in use; its SHA-1 registered.
- [ ] `authConfig.ts` updated and the app rebuilt; `firebaseProjectId` and `adminEmails` set on the server.
- [ ] `google-services.json` from this project in the app; FCM service account key on the hub, stored as a company secret.
- [ ] Load tests done **before** sign-in was switched on.
- [ ] Tested sign-up, sign-in and Google on the shipped build, from a venue-like single network.
