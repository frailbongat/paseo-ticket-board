import type { PluginClientContext } from "@getpaseo/plugin/client";
import { BOARD_PANEL_ID, BoardPanel } from "./client/board-panel";
import { BOARD_SURFACE_ID, BoardSurface } from "./client/board-surface";

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

  return () => {};
}
