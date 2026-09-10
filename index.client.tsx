import type { PluginClientContext } from "@getpaseo/plugin/client";
import { BOARD_PANEL_ID, BoardPanel } from "./client/board-panel";
import { BOARD_SURFACE_ID, BoardSurface } from "./client/board-surface";
import { BOARD_SETTINGS_SCREEN_ID, BoardSettingsScreen } from "./client/settings-screen";
import { TicketCard } from "./client/ticket-card";
import { contributeTicketPills } from "./client/ticket-pill";
import {
  TICKET_CARD_KIND,
  TICKET_CARD_VERSION,
  TicketCardSchema,
} from "./shared/tickets";

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

  // Draws the row the daemon pins to a dispatched agent's timeline. Without it
  // that row reads "Plugin timeline item unavailable".
  client.addTimelineRenderer({
    kind: TICKET_CARD_KIND,
    version: TICKET_CARD_VERSION,
    schema: TicketCardSchema,
    Component: TicketCard,
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

  // Names the ticket on the agent running it, and hands it back. Imperative and
  // agent-scoped, so unlike everything above it owns a subscription to tear down.
  const removeTicketPills = contributeTicketPills(client);

  return () => {
    removeTicketPills();
  };
}
