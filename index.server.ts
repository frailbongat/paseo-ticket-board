import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  agentTurnEndedHook,
  appendTicketCardHandler,
  claimDispatchHandler,
  listTicketsHandler,
  planDispatchHandler,
  workspaceArchivedHook,
} from "./server/tickets";
import {
  DEFAULT_VOCABULARY,
  type LabelVocabulary,
  boardSettings,
  vocabularyOf,
} from "./shared/settings";
import {
  appendTicketCard,
  claimDispatch,
  listTickets,
  planDispatch,
} from "./shared/tickets";

export default function contribute(server: PluginServerContext) {
  // The same host document the settings screen writes. Read per request, so a
  // label edit applies to the next list without a plugin reload.
  const settings = server.registerSettings(boardSettings);

  async function vocabulary(): Promise<LabelVocabulary> {
    const state = await settings.read();
    if (state.status === "ready") return vocabularyOf(state.values);
    // The client draws with the defaults on an unreadable document too, so the
    // two sides still agree on which tickets are listed.
    console.error(`[tickets] board settings unreadable, using defaults: ${state.error}`);
    return DEFAULT_VOCABULARY;
  }

  server.handle(listTickets, async (input, context) =>
    listTicketsHandler(input, context, await vocabulary()),
  );
  server.handle(planDispatch, async (input, context) =>
    planDispatchHandler(input, context, await vocabulary()),
  );
  server.handle(claimDispatch, claimDispatchHandler);
  // Only a plugin session may write a timeline row, so the card is appended
  // here rather than by the client that just created the agent.
  server.handle(appendTicketCard, appendTicketCardHandler);

  // The claim has to be given back, or an archived workspace leaves its ticket
  // reading `claimed` until somebody forces it.
  server.on("workspace.archived", workspaceArchivedHook);
  server.on("agent.turn_ended", agentTurnEndedHook);

  return () => {};
}
