// Sign-in providers. Leave everything empty to run without login (POC mode).
// Firebase (email/password + Google) and Microsoft run side by side; either can be left empty.

// Firebase Auth (Project settings > General). The web API key is not a secret.
export const FIREBASE_API_KEY = "AIzaSyDskycfYoUxF_TMPWJ_QR_OH5sED7q9Roc";

// Google sign-in (Android OAuth client from Google Cloud Console, same project as Firebase).
// Public identifier, not a secret. Empty hides the Google button.
export const GOOGLE_ANDROID_CLIENT_ID = "113829759136-bh8qvak0thcvkl4o1cscmbfhe2iijs08.apps.googleusercontent.com";

// Microsoft sign-in, via an ordinary Entra ID app registration (account types: any
// organizational directory + personal Microsoft accounts). Empty AUTH_CLIENT_ID hides the button.
//
// AUTH_CLIENT_ID: that registration's Application (client) ID. Public identifier, not a secret.
// AUTH_AUTHORITY: the common endpoint below covers work and personal accounts. Swap it for an
//   External ID tenant (https://<subdomain>.ciamlogin.com/<tenant-id>/v2.0) to move to Azure later.
// AUTH_REDIRECT_SCHEME: must match the registration's redirect URI: xconnect://auth
export const AUTH_AUTHORITY = "https://login.microsoftonline.com/common/v2.0";
export const AUTH_CLIENT_ID = "7181eccc-9044-4908-b881-dcdb45b388a4";
export const AUTH_REDIRECT_SCHEME = "xconnect";
