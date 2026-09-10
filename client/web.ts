import { Linking, Platform } from "react-native";

/**
 * The one module in the client bundle allowed to touch a browser global, so the
 * DOM stays out of `tsconfig.json` and out of every component.
 */

// Declared rather than pulled from `lib: DOM`, which would let every other
// client module reach for `document` without a compile error.
declare const window: { open(url: string, target: string, features: string): unknown };

/**
 * Opens a ticket or spec in the reader's browser. `Linking.openURL` hands a web
 * client its own tab through a navigation the host may block, so the web branch
 * opens the window directly.
 */
export async function openExternal(url: string): Promise<void> {
  if (Platform.OS === "web") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  await Linking.openURL(url);
}
