import { useSettings } from "@getpaseo/plugin/client";
import { useMemo } from "react";
import {
  BOARD_SETTINGS_DEFAULTS,
  type BoardSettings,
  boardSettings,
} from "../shared/settings";
import { type Appearance, buildAppearance } from "./theme";

/**
 * The board's settings, or the defaults while the host document is still being
 * read or is unreadable.
 *
 * The board draws before the read lands, so it needs values on the first
 * render. Falling back to the defaults keeps a fresh install identical to the
 * hardcoded board, and a settings screen is the place that reports a read
 * failure properly rather than the board header.
 */
export function useBoardSettings(): BoardSettings {
  const settings = useSettings(boardSettings);
  return settings.status === "ready" ? settings.values : BOARD_SETTINGS_DEFAULTS;
}

/**
 * The drawing tokens the saved appearance resolves to.
 *
 * `useSettings` is a live subscription, so a save in the settings screen pushes
 * new values through here on the next render. That is the whole mechanism
 * behind the board redrawing at a new size or face without a reload: no cache
 * to invalidate, no refetch, no remount. The memo is only there to keep the
 * token object referentially stable between unrelated renders, so the context
 * below it does not wake every consumer on each parent render.
 *
 * @param compact The host's narrow-viewport signal, folded into the spacing.
 */
export function useBoardAppearance(compact = false): Appearance {
  const { fontFamily, fontSize, cardDensity } = useBoardSettings();
  return useMemo(
    () => buildAppearance({ fontFamily, fontSize, cardDensity }, compact),
    [fontFamily, fontSize, cardDensity, compact],
  );
}
