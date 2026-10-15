// Sign-in providers. Leave everything empty to run without login (POC mode).
// Firebase (email/password + Google) and Microsoft run side by side; either can be left empty.

// Firebase Auth (Project settings > General). The web API key is not a secret.
export const FIREBASE_API_KEY = "AIzaSyAkA8TAV1FH-9w6vrupZj2-pqoMtwtxcO0";

// Google sign-in (Android OAuth client from Google Cloud Console, same project as Firebase).
// Public identifier, not a secret. Empty hides the Google button on Android.
export const GOOGLE_ANDROID_CLIENT_ID = "827690120478-1bcikupjpgf6ul2nfs2q759bu82m42j1.apps.googleusercontent.com";

// Google sign-in (iOS OAuth client from Google Cloud Console, same project as Firebase).
// Public identifier, not a secret. Empty hides the Google button on iOS.
export const GOOGLE_IOS_CLIENT_ID = "";

// Microsoft sign-in, via an ordinary Entra ID app registration (account types: any
// organizational directory + personal Microsoft accounts). Empty AUTH_CLIENT_ID hides the button.
//
// AUTH_CLIENT_ID: that registration's Application (client) ID. Public identifier, not a secret.
// AUTH_AUTHORITY: the common endpoint below covers work and personal accounts. Swap it for an
//   External ID tenant (https://<subdomain>.ciamlogin.com/<tenant-id>/v2.0) to move to Azure later.
// AUTH_REDIRECT_SCHEME: must match the registration's redirect URI: xconnect://auth
export const AUTH_AUTHORITY = "https://login.microsoftonline.com/common/v2.0";
export const AUTH_CLIENT_ID = "7a6235dd-08c7-4b33-8df3-8c8795de1994";
export const AUTH_REDIRECT_SCHEME = "xconnect";
