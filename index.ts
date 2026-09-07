import type { PluginContext } from "@getpaseo/plugin";
import { BOARD_PANEL_ID, BoardPanel } from "./board-panel.client";
import { BOARD_SURFACE_ID, BoardSurface } from "./board-surface.client";
import {
  claimDispatchHandler,
  listTicketsHandler,
  planDispatchHandler,
} from "./tickets.server";
import { claimDispatch, listTickets, planDispatch } from "./tickets.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(listTickets, listTicketsHandler);
  plugin.handle(planDispatch, planDispatchHandler);
  plugin.handle(claimDispatch, claimDispatchHandler);

  // The sidebar item is the only one of these three a phone can reach.
  plugin.addSurface(BOARD_SURFACE_ID, BoardSurface);
  plugin.addSidebarItem({
    id: "tickets",
    title: "Tickets",
    icon: "CircleDot",
    surface: BOARD_SURFACE_ID,
  });

  plugin.addWorkspacePanel({
    id: BOARD_PANEL_ID,
    title: "Tickets",
    icon: "CircleDot",
    context: "workspace",
    Component: BoardPanel,
  });

  plugin.addCommandCenterItem({
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
