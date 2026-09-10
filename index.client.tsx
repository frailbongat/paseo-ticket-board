import type { PluginClientContext } from "@getpaseo/plugin/client";
import { BOARD_PANEL_ID, BoardPanel } from "./client/board-panel";
import { BOARD_SURFACE_ID, BoardSurface } from "./client/board-surface";
import { BOARD_SETTINGS_SCREEN_ID, BoardSettingsScreen } from "./client/settings-screen";

export default function contribute(client: PluginClientContext) {
  // The sidebar item is the only one of these three a phone can reach.
  client.addSurface(BOARD_SURFACE_ID, BoardSurface);
  client.addSidebarItem({
    id: "tickets",
    title: "Tickets",
    icon: "CircleDot",
    surface: BOARD_SURFACE_ID,
  });

  client.addWorkspacePanel({
    id: BOARD_PANEL_ID,
    title: "Tickets",
    icon: "CircleDot",
    context: "workspace",
    Component: BoardPanel,
  });

  // Provider, label vocabulary, and batch width, per host rather than per build.
  client.addSettingsScreen({
    id: BOARD_SETTINGS_SCREEN_ID,
    title: "Ticket board",
    icon: "SlidersHorizontal",
    Component: BoardSettingsScreen,
  });

  client.addCommandCenterItem({
    id: "dispatch-ticket",
    title: "Dispatch ticket",
    icon: "CircleDot",
    keywords: [
      "ticket",
      "dispatch",
      "worktree",
      "agent",
      "wayfinder",
      "impeccable",
      "implement",
    ],
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel(BOARD_PANEL_ID);
    },
  });

  client.addCommandCenterItem({
    id: "ticket-board-settings",
    title: "Ticket board settings",
    icon: "SlidersHorizontal",
    keywords: ["ticket", "board", "settings", "provider", "label"],
    context: "global",
    onSelect({ openSettings }) {
      openSettings(BOARD_SETTINGS_SCREEN_ID);
    },
  });

  return () => {};
}
