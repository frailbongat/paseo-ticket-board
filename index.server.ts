import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  claimDispatchHandler,
  listTicketsHandler,
  planDispatchHandler,
} from "./server/tickets";
import { claimDispatch, listTickets, planDispatch } from "./shared/tickets";

export default function contribute(server: PluginServerContext) {
  server.handle(listTickets, listTicketsHandler);
  server.handle(planDispatch, planDispatchHandler);
  server.handle(claimDispatch, claimDispatchHandler);

  return () => {};
}
