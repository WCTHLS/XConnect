# Microsoft sign-in: which tenant should hold the app registration


## The goal

People who **already have a Microsoft account** (work, school or personal) sign in to XConnect with it.
XConnect does not host Microsoft sign-up. Email and password and Google sign-in run through Firebase
and are separate.

Register the app in a **Workforce** tenant, with supported account types **Any Entra ID tenant plus
personal Microsoft accounts**, and sign in through `https://login.microsoftonline.com/common/v2.0`.

Do **not** use an External (External ID) tenant for this registration.

## Workforce vs External tenants

| | Workforce tenant | External tenant (External ID) |
|---|---|---|
| What it is | A company's directory of employees and its apps | A directory you run for your own customers, who sign up with you |
| Accounts | The organization's own, plus invited guests | Local accounts customers create in the tenant, plus federated providers you add |
| Sign-in address | `login.microsoftonline.com` | `<name>.ciamlogin.com` |
| "Any Microsoft account" through `common` | Supported by Microsoft | Not described by Microsoft's documentation |
| Creating a new one | Needs a paid license | Available without one |

Microsoft's feature comparison says registrations in an external tenant "always use accounts in this
organizational directory only (single tenant)". The portal nevertheless lets you choose multitenant
plus personal accounts there, which is why the External registration looked correct.

## What was tested

Each registration was opened in a **clean (incognito) browser window** with a link of the form
`https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=<id>&response_type=code&redirect_uri=xconnect%3A%2F%2Fauth&scope=openid%20profile%20email&prompt=select_account`.

| Registration | Tenant type | Personal Microsoft account | School account (another organization) |
|---|---|---|---|
| Company `XConnectmobile` (`7a6235dd-...`) | External | **Refused** ("You can't sign in here with a personal account") | Accepted (reached the consent screen) |
| Personal `XConnect-test` (`7181eccc-...`) | Workforce | **Accepted** (reached Microsoft's personal-account step) | **Accepted**: signed in on a phone through the college's Duo multi-factor step,  |

Notes:
- All registrations had the correct manifest: `signInAudience` of
  `AzureADandPersonalMicrosoftAccount`, `requestedAccessTokenVersion` 2, and the redirect
  `xconnect://auth`. The difference is the tenant type, not a setting.
- The External registration appeared to work for personal accounts earlier the same day. That was
  almost certainly because the browser already had a personal Microsoft session cached. A new user on
  a new phone has none, so the clean-window result is the one that reflects real users.

## What the registration must contain

- **Name:** XConnect
- **Supported account types:** Any Entra ID tenant plus personal Microsoft accounts
- **Platform:** Mobile and desktop applications, redirect URI `xconnect://auth`
- **Allow public client flows:** Yes
- **Token configuration:** optional `email` claim on the ID token (accept the Graph `email` permission)
- **No client secret** and no other API permissions
- **Branding:** Terms of service and Privacy statement links (without them the consent screen says
  "unverified" and "The publisher has not provided links to their terms")

Choose the account type when the registration is **created**. Microsoft warns that switching audiences
afterwards can produce errors.

## Setting up the registration

Do them in the **Workforce** tenant, not the External one.
When the registration exists, send back the **Application (client) ID** and the **Directory (tenant) ID**.
The remaining steps (pointing the app and server at the registration, and testing) are done by the
developers.

### Step 1. Register the app

Create the registration in the tenant IT owns, and check the directory in the Azure portal before you
start (top right, Switch directory): a registration made in the wrong tenant is easy to miss because its
pages look identical.

1. Go to **Microsoft Entra ID**, then **App registrations**, then **+ New registration**.
2. Fill in:

   | Setting | Value |
   |---|---|
   | Name | `XConnect` |
   | Supported account types | **Any Entra ID Tenant + Personal Microsoft accounts** |
   | Redirect URI | Leave empty for now (set in step 2) |

3. Click **Register**.
4. On the **Overview** page, copy:
   - **Application (client) ID**. This is `AUTH_CLIENT_ID` and `authAudience`.
   - **Directory (tenant) ID**. This is `adminTenantId` (the tenant whose staff may be admins); it is not
     used in the authority URL, which stays `common`.

### Step 2. Add the mobile redirect

1. Open the registration, then **Authentication(Preview)**, then **+ Add a platform**.
2. Choose **Mobile and desktop applications**. 
3. Under **Custom redirect URIs**, add exactly:

   ```text
   xconnect://auth
   ```

  Make sure everything else is unticked.

4. Click **Configure**.
5. Still on **Authentication(Preview)**, select **Settings** and set **Allow public client flows** to
   **Yes**. Save. The app signs in with the authorization code flow and PKCE and has no client secret, so
   this setting is required. Without it the token request fails.

### Step 3. Check the API permissions

The app asks for `openid profile email offline_access`. On **API permissions**, the default
**Microsoft Graph, User.Read (Delegated)** is enough. Nothing else is needed. If the tenant restricts user
consent, people may see "Need admin approval" at first sign-in. In that case an admin clicks
**Grant admin consent for <tenant>** on this page once.

### Step 4. Make sure the email is in the token

The server reads the person's email from the ID token to recognize admins. It tries the `email`, `emails`,
`preferred_username` and `upn` claims, in that order. Personal Microsoft accounts do not always include
`email` by default, so add it:

1. Open the registration, then **Token configuration**.
2. **+ Add optional claim**, token type **ID**, tick **email**, then **Add**.
3. If asked to turn on the Microsoft Graph `email` permission, accept.

