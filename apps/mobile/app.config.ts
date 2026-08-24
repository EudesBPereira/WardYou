import type { ExpoConfig, ConfigContext } from "expo/config";

// Secrets come from the environment (.env / EAS secrets), never hardcoded.
// - GOOGLE_MAPS_ANDROID_KEY / GOOGLE_MAPS_IOS_KEY: native Maps SDK keys
// - EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY: Maps JS API key for the web preview (restrict by HTTP referrer)
const androidMapsKey = process.env.GOOGLE_MAPS_ANDROID_KEY ?? "";
const iosMapsKey = process.env.GOOGLE_MAPS_IOS_KEY ?? "";

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "WardYou",
  slug: "wityu",
  scheme: "wityu",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.wityu.app",
    // Universal Links: https://app.wityu.com/... opens the app (requires the
    // matching apple-app-site-association file hosted at that domain).
    associatedDomains: ["applinks:app.wityu.com"],
    config: {
      googleMapsApiKey: iosMapsKey,
    },
    infoPlist: {
      // Keep broadcasting trip location while the app is backgrounded/closed.
      UIBackgroundModes: ["location", "fetch"],
    },
  },
  android: {
    package: "com.wityu.app",
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
    // Lets the app show the system "ignore battery optimizations" dialog so the
    // trip-tracking foreground service survives aggressive OEM power managers
    // (Xiaomi & co. kill optimized apps' services when the app is swiped away).
    permissions: ["android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS"],
    // App Links: verified https://app.wityu.com/... deep links (requires the
    // assetlinks.json file hosted at that domain).
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        data: [{ scheme: "https", host: "app.wityu.com" }],
        category: ["BROWSABLE", "DEFAULT"],
      },
    ],
    adaptiveIcon: {
      // White, not the brand navy: the official mark (Image/WardYou-icon.png) is a
      // blue shield + "W" drawn for a light background — on #0B1F33 the dark-blue
      // half of it loses almost all contrast and the shield reads as a smudge.
      backgroundColor: "#FFFFFF",
      foregroundImage: "./assets/android-icon-foreground.png",
      backgroundImage: "./assets/android-icon-background.png",
      monochromeImage: "./assets/android-icon-monochrome.png",
    },
    config: {
      googleMaps: { apiKey: androidMapsKey },
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    bundler: "metro",
    output: "single",
    favicon: "./assets/favicon.png",
  },
  plugins: [
    "expo-router",
    // Biometric app lock + SOS/antifurto dismiss. iOS needs a Face ID usage
    // string; Android's USE_BIOMETRIC permission is added by the plugin.
    [
      "expo-local-authentication",
      { faceIDPermission: "WardYou usa o Face ID para desbloquear o app e desligar o alarme antifurto." },
    ],
    "expo-localization",
    "expo-secure-store",
    "expo-web-browser",
    "expo-font",
    "expo-audio",
    // Push notifications (adds POST_NOTIFICATIONS on Android 13+, notification
    // colour). Delivery is via our own FCM HTTP v1 sender, not Expo push.
    // `icon` generates the `notification_icon` drawable (white WardYou shield
    // silhouette) used as the status-bar small icon by our pushes AND by
    // expo-location's foreground-service notification (it prefers that
    // resource over the app icon, which rendered as a grey circle).
    ["expo-notifications", { icon: "./assets/notification-icon.png", color: "#1875BE" }],
    [
      "expo-splash-screen",
      {
        // Match the app's light background (`background` token #F4F7F8) so the
        // splash flows seamlessly into the first screen instead of flashing a
        // dark navy that clashes with the light UI.
        backgroundColor: "#F4F7F8",
        image: "./assets/splash-icon.png",
        imageWidth: 120,
      },
    ],
    [
      "expo-image-picker",
      {
        photosPermission:
          "WardYou uses your photos so you can set a profile picture that your family sees on the map.",
      },
    ],
    [
      "expo-location",
      {
        locationAlwaysAndWhenInUsePermission:
          "WardYou uses your location to share it with your family during trips and emergencies.",
        locationWhenInUsePermission:
          "WardYou uses your location to share it with your family during trips and emergencies.",
        // Background + foreground service: needed so a shared trip keeps
        // broadcasting the member's location even when the app is closed
        // (Android runs a persistent-notification foreground location service).
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
  },
});
