import { useSettings } from "@getpaseo/plugin/client";
import {
  BOARD_SETTINGS_DEFAULTS,
  type BoardSettings,
  boardSettings,
} from "../shared/settings";

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
