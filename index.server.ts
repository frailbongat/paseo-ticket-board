import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  agentTurnEndedHook,
  appendTicketCardHandler,
  claimDispatchHandler,
  listTicketsHandler,
  planDispatchHandler,
  stopRouting,
  workspaceArchivedHook,
} from "./server/tickets";
import { boardSettings } from "./shared/settings";
import {
  appendTicketCard,
  claimDispatch,
  listTickets,
  planDispatch,
} from "./shared/tickets";

export default function contribute(server: PluginServerContext) {
  // Host-side persistence for the settings screen. The handlers below never read
  // this document: the daemon has no read side, so the client sends its labels
  // along with the request.
  server.registerSettings(boardSettings);

  server.handle(listTickets, listTicketsHandler);
  server.handle(planDispatch, planDispatchHandler);
  server.handle(claimDispatch, claimDispatchHandler);
  // Only a plugin session may write a timeline row, so the card is appended
  // here rather than by the client that just created the agent.
  server.handle(appendTicketCard, appendTicketCardHandler);

  // The claim has to be given back, or an archived workspace leaves its ticket
  // reading `claimed` until somebody forces it.
  server.on("workspace.archived", workspaceArchivedHook);
  server.on("agent.turn_ended", agentTurnEndedHook);

  // Routing runs behind the draw that queued it, so the backlog can still be
  // working when the plugin stops. Each route is a pi subprocess, and nothing
  // else would take those down.
  return () => {
    stopRouting();
  };
}
