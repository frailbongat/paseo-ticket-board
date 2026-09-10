import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  agentTurnEndedHook,
  claimDispatchHandler,
  listTicketsHandler,
  planDispatchHandler,
  workspaceArchivedHook,
} from "./server/tickets";
import { claimDispatch, listTickets, planDispatch } from "./shared/tickets";

export default function contribute(server: PluginServerContext) {
  server.handle(listTickets, listTicketsHandler);
  server.handle(planDispatch, planDispatchHandler);
  server.handle(claimDispatch, claimDispatchHandler);

  // The claim has to be given back, or an archived workspace leaves its ticket
  // reading `claimed` until somebody forces it.
  server.on("workspace.archived", workspaceArchivedHook);
  server.on("agent.turn_ended", agentTurnEndedHook);

  return () => {};
}
