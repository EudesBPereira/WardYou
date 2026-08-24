import * as ImagePicker from "expo-image-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";

/**
 * Prompt for a photo, downscale it to a small square, and return a compact
 * `data:image/jpeg;base64,...` URI (tens of KB). Storing it straight in the
 * profile avatar needs no blob storage, and the data URI renders on the map
 * and in lists exactly like a Google photo URL. Returns null if the user
 * cancels or denies photo access.
 */
export async function pickAvatarDataUri(): Promise<string | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;

  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });
  if (picked.canceled || !picked.assets?.[0]) return null;

  const shrunk = await manipulateAsync(
    picked.assets[0].uri,
    [{ resize: { width: 256 } }],
    { compress: 0.6, format: SaveFormat.JPEG, base64: true },
  );
  if (!shrunk.base64) return null;
  return `data:image/jpeg;base64,${shrunk.base64}`;
}
