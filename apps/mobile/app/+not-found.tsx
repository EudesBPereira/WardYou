import { Redirect } from "expo-router";

/**
 * Any deep link that doesn't match a route lands here. Never show Expo
 * Router's stock "Unmatched Route" page to users — send them to the root,
 * where AuthGate routes to the right home (or login).
 */
export default function NotFoundScreen() {
  return <Redirect href="/" />;
}
