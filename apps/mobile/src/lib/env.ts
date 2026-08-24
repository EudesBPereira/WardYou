// Public env (inlined by Expo at build time via the EXPO_PUBLIC_ prefix).
// Never put secrets here — only values safe to ship in the client bundle.

export const env = {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? "",
  googleMapsWebKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY ?? "",
  googleOAuthClientId: process.env.EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID ?? "",
  facebookAppId: process.env.EXPO_PUBLIC_FACEBOOK_APP_ID ?? "",
  useMocks: process.env.EXPO_PUBLIC_USE_MOCKS === "true",
};

/** Whether a real backend is configured. */
export const hasApi = env.apiBaseUrl.length > 0;

/** Use mock repositories when no API is set, or when explicitly forced via env. */
export const useMocks = !hasApi || env.useMocks;
