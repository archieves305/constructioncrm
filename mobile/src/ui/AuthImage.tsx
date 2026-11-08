import { useEffect, useState } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { Image, type ImageStyle } from "expo-image";
import Ionicons from "@expo/vector-icons/Ionicons";
import { CRM_URL } from "@/config";
import { readToken } from "@/auth/storage";
import { useTheme } from "./theme";

let tokenCache: string | null = null;

/** The sign-in token for image requests (read once; images ask often). */
export function useImageToken(): string | null {
  const [token, setToken] = useState(tokenCache);
  useEffect(() => {
    if (tokenCache) return;
    void readToken().then((v) => {
      tokenCache = v;
      setToken(v);
    });
  }, []);
  return token;
}

/** Forget the token held for images (sign-out). */
export function forgetImageToken() {
  tokenCache = null;
}

/**
 * A photo served by the CRM (`/api/files/:id`, `/api/photos/:id/raw`), fetched
 * with the sign-in header and cached on the phone's disk (cleared at sign-out),
 * so a photo seen once still shows without signal.
 */
export function AuthImage({ path, style, contentFit = "cover", missing }: { path: string; style?: StyleProp<ImageStyle>; contentFit?: "cover" | "contain"; missing?: boolean }) {
  const t = useTheme();
  const token = useImageToken();
  if (missing || !token)
    return (
      <View style={[style as StyleProp<ViewStyle>, { alignItems: "center", justifyContent: "center", backgroundColor: t.border }]}>
        {missing ? <Ionicons name="image-outline" size={24} color={t.muted} accessibilityLabel="Photo missing" /> : null}
      </View>
    );
  return (
    <Image
      source={{ uri: `${CRM_URL}${path}`, headers: { Authorization: `Bearer ${token}` }, cacheKey: path }}
      style={style}
      contentFit={contentFit}
      cachePolicy="disk"
      transition={120}
      recyclingKey={path}
    />
  );
}
