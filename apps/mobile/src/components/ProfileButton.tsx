import { Pressable } from "react-native";
import { router } from "expo-router";
import { Avatar } from "./ui";
import { useSession } from "@/stores/session";
import { useMyProfile } from "@/features/profile/queries";

/**
 * Top-right account avatar shown across the main tabs. Tapping it opens the
 * profile screen.
 *
 * Deliberately takes **no size prop**: this is the same chrome on every screen,
 * so letting each caller pick a size is what made Home render a bigger avatar
 * than the other tabs. One canonical size lives here — change it once and every
 * header follows.
 *
 * Prefers the profile query (fresh — reflects a photo the user just set) and
 * falls back to the persisted session so the avatar is right on first paint,
 * before the query resolves.
 */
export function ProfileButton() {
  const session = useSession((s) => s.session);
  const { data: profile } = useMyProfile();
  if (!session) return null;

  const name = profile?.fullName ?? session.fullName;
  const avatarUrl = profile?.avatarUrl ?? session.avatarUrl ?? null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      hitSlop={10}
      onPress={() => router.navigate("/profile")}
      className="active:opacity-70"
    >
      <Avatar name={name} uri={avatarUrl} size="md" status="online" />
    </Pressable>
  );
}
