// Expo passes the values from app.json in as `config`. Only what depends on the environment is
// added here, so no environment-specific IDs sit in the repository.
//
// iOS Google sign-in returns to the app through a URL scheme made from the iOS OAuth client ID
// (com.googleusercontent.apps.<client id>). It is read from the same variable the app uses,
// EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID in apps/mobile/.env. EAS builds need that variable set as an EAS
// environment variable, because .env is not uploaded.
//
// Setting CFBundleURLTypes makes Expo ignore the top-level `scheme` on iOS, so the app's own scheme
// (xconnect, used by the Microsoft sign-in redirect) is listed here as well.
module.exports = ({ config }) => {
  const iosClientId = (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID || '')
    .trim()
    .replace(/\.apps\.googleusercontent\.com$/, '');

  if (!iosClientId) return config;

  const appSchemes = [].concat(config.scheme || []);

  return {
    ...config,
    ios: {
      ...config.ios,
      infoPlist: {
        ...config.ios?.infoPlist,
        CFBundleURLTypes: [
          { CFBundleURLSchemes: [...appSchemes, `com.googleusercontent.apps.${iosClientId}`] },
        ],
      },
    },
  };
};
